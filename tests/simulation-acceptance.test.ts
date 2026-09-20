import { describe, expect, it } from "vitest";
import { FactorySimulation } from "../packages/simulation/src/index.ts";
import {
  SCENARIOS,
  LINE_IDS,
  type DecisionRecord,
  type FactoryCommand,
  type ModuleInstance,
} from "../packages/contracts/src/index.ts";

const start = (sim: FactorySimulation, id = "start") =>
  expect(sim.command({ id, type: "start" }).ok).toBe(true);
const materialDelta = (sim: FactorySimulation) => {
  const s = sim.snapshot();
  return (
    s.metrics.initial +
    s.metrics.received -
    s.metrics.consumed -
    Object.values(s.warehouse).reduce((a, b) => a + b, 0) -
    Object.values(s.stations).reduce((a, b) => a + b.stock, 0) -
    s.carts.reduce((a, c) => a + c.amount, 0)
  );
};

describe("simulation release acceptance", () => {
  for (const scenario of SCENARIOS)
    it(`${scenario}: conserves stock during disruption and makes progress after recovery`, () => {
      const sim = new FactorySimulation({ scenario, seed: 2026 });
      start(sim);
      sim.advance(600);
      const before = sim.snapshot();
      expect(materialDelta(sim)).toBe(0);
      if (scenario === "assembly-outage")
        expect(before.metrics.completed).toBe(0);
      if (scenario === "dispatch-blockage")
        expect(before.metrics.dispatched).toBe(0);
      if (scenario === "shortage")
        expect(before.trucks.some((t) => t.phase === "waiting")).toBe(true);
      expect(sim.command({ id: "repair-site", type: "repair" }).ok).toBe(true);
      if (scenario === "gripper")
        expect(
          sim.command({ id: "service-front", type: "repair", station: "front" })
            .ok,
        ).toBe(true);
      if (scenario === "slow-exterior")
        expect(
          sim.command({
            id: "faster-exterior",
            type: "profile",
            station: "exterior",
            value: "fast",
          }).ok,
        ).toBe(true);
      sim.advance(900);
      const after = sim.snapshot();
      expect(after.metrics.completed).toBeGreaterThan(before.metrics.completed);
      expect(after.metrics.dispatched).toBeGreaterThan(
        before.metrics.dispatched,
      );
      expect(materialDelta(sim)).toBe(0);
      expect(after.vehicles.length).toBeLessThanOrEqual(
        after.config.parkingCapacity,
      );
      expect(
        LINE_IDS.every(
          (l) => after.stations[l].queue.length <= after.stations[l].capacity,
        ),
      ).toBe(true);
    });

  it("keeps control revisions valid through ordinary production but rejects intervening changes", () => {
    const sim = new FactorySimulation();
    start(sim);
    const observed = sim.snapshot();
    sim.advance(100);
    expect(sim.snapshot().revision).toBe(observed.revision);
    expect(
      sim.command({
        id: "speed-later",
        type: "speed",
        value: 10,
        revision: observed.revision,
        epoch: observed.epoch,
      }).ok,
    ).toBe(true);
    expect(
      sim.command({
        id: "stale-profile",
        type: "profile",
        station: "front",
        value: "fast",
        revision: observed.revision,
        epoch: observed.epoch,
      }).ok,
    ).toBe(false);
  });
  it("serializes both road directions fairly, holds completed cars, and recovers after dispatch blockage", () => {
    const sim = new FactorySimulation({
      dispatchDwell: 5,
      releaseRate: 3,
      profiles: {
        front: "fast",
        rear: "fast",
        battery: "fast",
        interior: "fast",
        exterior: "fast",
      },
    });
    let holder: string | null = null;
    const conflicts: string[] = [];
    const directions = new Set<string>();
    sim.subscribeEvents((entry) => {
      if (entry.kind !== "event") return;
      const e = entry.event;
      if (e.type === "road-reserved") {
        if (holder !== null) conflicts.push(`${e.entity} overlaps ${holder}`);
        holder = e.entity;
        directions.add(String(e.data?.direction));
      }
      if (e.type === "road-released") {
        if (holder !== e.entity)
          conflicts.push(`${e.entity} releases ${holder}`);
        holder = null;
      }
    });
    start(sim);
    sim.advance(900);
    let s = sim.snapshot();
    expect(conflicts).toEqual([]);
    expect(directions).toEqual(new Set(["parking", "dispatch"]));
    expect(s.metrics.dispatched).toBeGreaterThan(10);
    expect(s.metrics.roadWait).toBeGreaterThan(0);
    expect(
      s.vehicles.filter((v) =>
        ["outbound", "parking", "dispatching"].includes(v.phase),
      ).length,
    ).toBeLessThanOrEqual(1);
    sim.command({ id: "block-dispatch", type: "fault", value: "dispatch" });
    sim.advance(700);
    s = sim.snapshot();
    expect(s.vehicles).toHaveLength(12);
    expect(
      Object.values(s.stations).some((st) => st.status === "blocked"),
    ).toBe(true);
    const before = s.metrics.dispatched;
    sim.command({ id: "release-dispatch", type: "repair" });
    sim.advance(900);
    s = sim.snapshot();
    expect(s.metrics.dispatched).toBeGreaterThan(before + 10);
    expect(conflicts).toEqual([]);
    expect(materialDelta(sim)).toBe(0);
    expect(s.metrics.roadOccupancy).toBeLessThanOrEqual(1);
  });
  it("rejects more than twelve physical bays and conflicting imported road occupants", () => {
    expect(() => new FactorySimulation({ parkingCapacity: 13 })).toThrow();
    const sim = new FactorySimulation();
    expect(
      sim.command({
        id: "too-many",
        type: "config",
        value: "parkingCapacity:24",
      }).ok,
    ).toBe(false);
    start(sim);
    sim.advance(220);
    const checkpoint = sim.exportRun();
    expect(checkpoint.snapshot.vehicles.length).toBeGreaterThanOrEqual(2);
    checkpoint.snapshot.vehicles[0].phase = "outbound";
    checkpoint.snapshot.vehicles[1].phase = "dispatching";
    expect(() => FactorySimulation.fromExport(checkpoint)).toThrow(/road/);
  });
  it("keeps inspected cargo in authoritative sorting custody for fourteen seconds before any inventory acceptance", () => {
    const sim = new FactorySimulation({ scenario: "empty", seed: 42 });
    start(sim);
    sim.advance(30);
    let state = sim.snapshot();
    expect(state.trucks).toHaveLength(1);
    expect(state.trucks[0]).toMatchObject({
      phase: "sorting",
      inspection: "accepted",
      start: 30,
      end: 44,
    });
    expect(state.metrics.received).toBe(0);
    expect(state.metrics.consumed).toBe(0);
    expect(Object.values(state.warehouse).reduce((a, b) => a + b, 0)).toBe(0);
    expect(state.carts).toHaveLength(0);
    expect(state.metrics.sortingKits).toBe(75);
    expect(
      state.events.some((e) => e.type === "receiving-inspection-passed"),
    ).toBe(true);
    expect(state.events.some((e) => e.type === "sorting-start")).toBe(true);
    const restored = FactorySimulation.fromExport(sim.exportRun());
    expect(restored.snapshot().trucks[0].phase).toBe("sorting");
    restored.command({ id: "resume-sorting", type: "start" });
    sim.advance(13.99);
    state = sim.snapshot();
    expect(state.trucks[0].phase).toBe("sorting");
    expect(state.metrics.received).toBe(0);
    expect(state.metrics.consumed).toBe(0);
    sim.advance(0.01);
    restored.advance(14);
    state = sim.snapshot();
    expect(state.trucks[0].phase).toBe("departing");
    expect(state.metrics.received).toBe(75);
    expect(state.metrics.sortedDeliveries).toBe(1);
    expect(state.metrics.sortingTime).toBeCloseTo(14, 7);
    expect(
      state.events.find((e) => e.type === "shipment-received")?.time,
    ).toBeCloseTo(44, 7);
    expect(materialDelta(sim)).toBe(0);
    expect(restored.snapshot().warehouse).toEqual(state.warehouse);
    expect(restored.snapshot().carts).toEqual(state.carts);
    sim.advance(60);
    expect(sim.snapshot().metrics.consumed).toBeGreaterThan(0);
    expect(materialDelta(sim)).toBe(0);
  });
  it("holds interrupted final assembly and resumes its remaining processing time", () => {
    const sim = new FactorySimulation();
    start(sim);
    sim.advance(50);
    const vehicle = sim.snapshot().vehicles.find((v) => v.phase === "joining")!;
    expect(vehicle).toBeDefined();
    const remaining = vehicle.end - sim.snapshot().time;
    expect(remaining).toBeGreaterThan(0);
    sim.command({ id: "outage", type: "fault", value: "assembly" });
    sim.advance(100);
    const held = sim.snapshot().vehicles.find((v) => v.id === vehicle.id)!;
    expect(held.phase).toBe("joining");
    expect(held.end - sim.snapshot().time).toBeCloseTo(remaining, 7);
    sim.command({ id: "recover", type: "repair" });
    sim.advance(remaining - 0.25);
    expect(
      sim.snapshot().vehicles.find((v) => v.id === vehicle.id)!.phase,
    ).toBe("joining");
    sim.advance(0.5);
    expect(
      sim.snapshot().vehicles.find((v) => v.id === vehicle.id)!.phase,
    ).toBe("testing");
  });

  it("reproduces a recorded AI decision schedule without invoking either provider", () => {
    const source = new FactorySimulation({ seed: 918 }),
      replay = new FactorySimulation({ seed: 918 });
    const schedule: {
      at: number;
      command: FactoryCommand;
      provider: "astra" | "jev";
    }[] = [
      { at: 0, command: { id: "run", type: "start" }, provider: "astra" },
      {
        at: 40,
        command: {
          id: "tune",
          type: "profile",
          station: "exterior",
          value: "fast",
        },
        provider: "astra",
      },
      {
        at: 105,
        command: { id: "inspect", type: "repair", station: "front" },
        provider: "jev",
      },
      {
        at: 260,
        command: { id: "hold", type: "fault", value: "dispatch" },
        provider: "astra",
      },
      {
        at: 440,
        command: { id: "recover", type: "repair" },
        provider: "astra",
      },
    ];
    const records: DecisionRecord[] = [];
    for (const { at, command, provider } of schedule) {
      source.advance(at - source.snapshot().time);
      const revision = source.snapshot().revision;
      const result = source.command(command);
      expect(result.ok).toBe(true);
      const record: DecisionRecord = {
        id: `decision-${command.id}`,
        provider,
        time: at,
        summary: `Recorded action: ${command.type}`,
        status: "applied",
        latency: 0,
        tokens: 0,
        commands: [command],
        revision,
      };
      records.push(record);
      source.addDecision(record);
    }
    source.advance(1000 - source.snapshot().time);
    for (const record of records) {
      replay.advance(record.time - replay.snapshot().time);
      for (const command of record.commands)
        expect(replay.command(command).ok).toBe(true);
      replay.addDecision(record);
    }
    replay.advance(1000 - replay.snapshot().time);
    const a = source.snapshot(),
      b = replay.snapshot();
    a.metrics.simulationMs = b.metrics.simulationMs = 0;
    expect(a).toEqual(b);
    expect(a.providers).toEqual({ astra: false, jev: false });
  });

  it("retains dispatched-vehicle ancestry in export, rooted in actual receiving lots", () => {
    const sim = new FactorySimulation({ scenario: "empty", seed: 77 });
    start(sim);
    sim.advance(1200);
    const run = sim.exportRun();
    const audit = run.internal.audit as {
      id: string;
      modules: ModuleInstance[];
      created: number;
      completedAt: number;
      dispatchedAt: number;
    }[];
    expect(audit.length).toBeGreaterThan(10);
    const received = new Set(
      run.snapshot.events
        .filter((e) => e.type === "shipment-received")
        .map((e) => e.data!.lot),
    );
    const moduleIDs: string[] = [];
    for (const vehicle of audit) {
      expect(vehicle.modules).toHaveLength(5);
      expect(new Set(vehicle.modules.map((m) => m.line)).size).toBe(5);
      expect(vehicle.completedAt).toBeGreaterThan(vehicle.created);
      expect(vehicle.dispatchedAt).toBeGreaterThan(vehicle.completedAt);
      for (const module of vehicle.modules) {
        expect(module.accepted).toBe(true);
        expect(received.has(module.lot)).toBe(true);
        moduleIDs.push(module.id);
      }
    }
    expect(new Set(moduleIDs).size).toBe(moduleIDs.length);
    const restored = FactorySimulation.fromExport(run).exportRun();
    expect(restored.internal.audit).toEqual(run.internal.audit);
  });

  it("rejects late actions after pause, mode takeover and reset without duplicate effects", () => {
    const sim = new FactorySimulation();
    start(sim);
    sim.advance(10);
    for (const action of ["pause", "mode", "reset"] as const) {
      const { epoch, revision } = sim.snapshot();
      const id = `barrier-${action}`;
      expect(
        sim.command({
          id,
          type: action,
          ...(action === "mode" ? { value: "manual" } : {}),
        }).ok,
      ).toBe(true);
      expect(
        sim.command({
          id: `late-${action}`,
          type: "repair",
          station: "front",
          epoch,
          revision,
        }).ok,
      ).toBe(false);
      expect(
        sim.command({
          id: `late-${action}`,
          type: "repair",
          station: "front",
          epoch,
          revision,
        }).ok,
      ).toBe(false);
    }
    const before = sim.snapshot().metrics.maintenanceCost;
    const command: FactoryCommand = {
      id: "one-service",
      type: "repair",
      station: "front",
    };
    expect(sim.command(command).ok).toBe(true);
    expect(sim.command(command).ok).toBe(true);
    expect(sim.snapshot().metrics.maintenanceCost - before).toBe(3);
  });
});
