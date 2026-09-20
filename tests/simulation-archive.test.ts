import { describe, it, expect } from "vitest";
import {
  FactorySimulation,
  type AuditEntry,
} from "../packages/simulation/src/index.ts";
import { replayArchive } from "../packages/simulation/src/replay.ts";

describe("lossless external archive boundary", () => {
  it("rejects an incoming lot, returns its cargo, and replenishes without phantom inventory", () => {
    const sim = new FactorySimulation({ scenario: "empty", seed: 147 });
    sim.command({ id: "run", type: "start" });
    sim.advance(31);
    let snapshot = sim.snapshot();
    expect(snapshot.metrics.rejectedDeliveries).toBe(1);
    expect(snapshot.metrics.rejectedIncomingKits).toBe(75);
    expect(snapshot.metrics.received).toBe(0);
    expect(snapshot.metrics.consumed).toBe(0);
    expect(snapshot.trucks[0]).toMatchObject({
      inspection: "rejected",
      phase: "departing",
    });
    const restored = FactorySimulation.fromExport(sim.exportRun());
    expect(restored.snapshot().trucks[0].inspection).toBe("rejected");
    sim.advance(15);
    snapshot = sim.snapshot();
    expect(snapshot.metrics.supplierReturnKits).toBe(75);
    expect(snapshot.metrics.receivingConservationDelta).toBe(0);
    sim.advance(300);
    snapshot = sim.snapshot();
    expect(snapshot.metrics.completed).toBeGreaterThan(0);
    expect(snapshot.metrics.conservationDelta).toBe(0);
    expect(snapshot.metrics.receivingConservationDelta).toBe(0);
    const allModules = [
      ...Object.values(snapshot.stations).flatMap((st) => [
        ...st.queue,
        ...(st.current ? [st.current] : []),
      ]),
      ...snapshot.vehicles.flatMap((v) => v.modules),
    ];
    expect(allModules.some((module) => module.lot === "lot-1")).toBe(false);
  });
  it("replays from an active checkpoint without repeating previously applied command IDs", () => {
    const source = new FactorySimulation();
    source.command({ id: "start", type: "start" });
    source.advance(20);
    source.command({ id: "service-once", type: "repair", station: "front" });
    const checkpoint = source.exportRun();
    const entries: AuditEntry[] = [];
    source.subscribeEvents((e) => entries.push(e));
    source.advance(30);
    source.command({ id: "service-once", type: "repair", station: "front" });
    source.advance(100);
    const replay = replayArchive(checkpoint, entries, source.snapshot().time);
    expect(replay.snapshot().metrics.maintenanceCost).toBe(
      source.snapshot().metrics.maintenanceCost,
    );
    expect(replay.snapshot().vehicles).toEqual(source.snapshot().vehicles);
  });
  it("restores bounded validated command history so imported retries cannot repeat reset or maintenance", () => {
    const source = new FactorySimulation();
    source.command({ id: "old-reset", type: "reset" });
    source.command({ id: "old-start", type: "start" });
    source.advance(100);
    source.command({ id: "old-maintenance", type: "repair", station: "front" });
    const checkpoint = source.exportRun(),
      restored = FactorySimulation.fromExport(checkpoint),
      before = restored.snapshot();
    expect(restored.command({ id: "old-reset", type: "reset" }).ok).toBe(true);
    expect(restored.snapshot().time).toBe(before.time);
    expect(restored.snapshot().epoch).toBe(before.epoch);
    expect(
      restored.command({
        id: "old-maintenance",
        type: "repair",
        station: "front",
      }).ok,
    ).toBe(true);
    expect(restored.snapshot().metrics.maintenanceCost).toBe(
      before.metrics.maintenanceCost,
    );
    expect(restored.command({ id: "old-start", type: "start" }).ok).toBe(true);
    expect(restored.snapshot().running).toBe(false);
    expect(restored.command({ id: "new-start", type: "start" }).ok).toBe(true);
    expect(restored.snapshot().running).toBe(true);
    const invalid = source.exportRun();
    invalid.internal.commands = [
      ["bad", { ok: true, message: "bad", revision: Infinity }],
    ];
    expect(() => FactorySimulation.fromExport(invalid)).toThrow();
    const duplicate = source.exportRun();
    duplicate.internal.commands = [
      ["a", { ok: true, message: "ok", revision: 0 }],
      ["a", { ok: true, message: "ok", revision: 0 }],
    ];
    expect(() => FactorySimulation.fromExport(duplicate)).toThrow();
    const future = source.exportRun();
    future.internal.commands = [
      [
        "future",
        { ok: true, message: "ok", revision: source.snapshot().revision + 1 },
      ],
    ];
    expect(() => FactorySimulation.fromExport(future)).toThrow();
    for (let i = 0; i < 510; i++)
      source.command({ id: `setting-${i}`, type: "speed", value: 1 });
    expect((source.exportRun().internal.commands as unknown[]).length).toBe(
      500,
    );
    expect(() =>
      FactorySimulation.fromExport(source.exportRun()),
    ).not.toThrow();
    const oversized = source.exportRun();
    (oversized.internal.commands as unknown[]).push([
      "overflow",
      { ok: true, message: "ok", revision: 1 },
    ]);
    expect(() => FactorySimulation.fromExport(oversized)).toThrow();
  });
  it("replays a legitimate command-ID reuse after the same 500-entry eviction window", () => {
    const source = new FactorySimulation(),
      initial = source.exportRun(),
      entries: AuditEntry[] = [];
    source.subscribeEvents((entry) => entries.push(entry));
    expect(
      source.command({
        id: "reusable",
        type: "config",
        value: "dispatchDwell:10",
        epoch: 0,
        revision: 0,
      }).ok,
    ).toBe(true);
    for (let i = 0; i < 510; i++)
      expect(
        source.command({ id: `filler-${i}`, type: "speed", value: 1 }).ok,
      ).toBe(true);
    const before = source.snapshot();
    expect(
      source.command({
        id: "reusable",
        type: "config",
        value: "dispatchDwell:25",
        epoch: before.epoch,
        revision: before.revision,
      }).ok,
    ).toBe(true);
    source.command({ id: "run", type: "start" });
    source.advance(100);
    const replay = replayArchive(initial, entries, 100);
    expect(replay.snapshot().config.dispatchDwell).toBe(25);
    expect(replay.snapshot().vehicles).toEqual(source.snapshot().vehicles);
    expect(replay.snapshot().revision).toBe(source.snapshot().revision);
  });
  it("preserves payload-conflict detection after import and accepts legacy checkpoints without payload records", () => {
    const source = new FactorySimulation();
    source.command({
      id: "setting",
      type: "config",
      value: "dispatchDwell:20",
    });
    const exported = source.exportRun();
    const restored = FactorySimulation.fromExport(exported);
    expect(
      restored.command({
        id: "setting",
        type: "config",
        value: "dispatchDwell:30",
      }),
    ).toMatchObject({
      ok: false,
      message: "Command id was already used for a different command.",
    });
    expect(restored.snapshot().config.dispatchDwell).toBe(20);
    delete exported.internal.commandPayloads;
    expect(() => FactorySimulation.fromExport(exported)).not.toThrow();
  });
  it("streams all events and every dispatched genealogy beyond RAM retention", () => {
    const simulation = new FactorySimulation();
    const entries: AuditEntry[] = [];
    const unsubscribe = simulation.subscribeEvents(
      (entry) => entries.push(entry),
      { replayRetained: true },
    );
    simulation.command({ id: "run", type: "start" });
    simulation.advance(7200);
    simulation.advance(7200);
    const events = entries
      .filter((e) => e.kind === "event")
      .map((e) => e.event);
    const lineages = entries.filter((e) => e.kind === "lineage");
    const current = simulation.snapshot();
    expect(events.length).toBeGreaterThan(4000);
    expect(current.events).toHaveLength(2000);
    expect(events.map((e) => e.id)).toEqual(
      Array.from({ length: events.length }, (_, i) => i + 1),
    );
    expect(lineages).toHaveLength(current.metrics.dispatched);
    expect(lineages.length).toBeGreaterThan(200);
    const before = entries.length;
    unsubscribe();
    simulation.advance(100);
    expect(entries).toHaveLength(before);
  });
  it("preserves subscribers across reset and records command origin time/epoch", () => {
    const simulation = new FactorySimulation();
    const entries: AuditEntry[] = [];
    simulation.subscribeEvents((e) => entries.push(e));
    simulation.command({ id: "start", type: "start" });
    simulation.advance(200);
    simulation.command({ id: "reset", type: "reset", scenario: "empty" });
    simulation.command({ id: "restart", type: "start" });
    simulation.advance(100);
    const reset = entries.find(
      (e) => e.kind === "command" && e.command.type === "reset",
    );
    expect(reset).toMatchObject({
      kind: "command",
      time: 200,
      epoch: 0,
      result: { ok: true },
    });
    expect(
      entries.some(
        (e) =>
          e.kind === "event" &&
          e.event.type === "shipment-received" &&
          e.event.data?.epoch === 1,
      ),
    ).toBe(true);
  });
  it("isolates subscriber mutation and reports sink failure without losing manufacturing", () => {
    const simulation = new FactorySimulation();
    simulation.subscribeEvents((e) => {
      if (e.kind === "event") e.event.message = "MUTATED";
    });
    simulation.subscribeEvents(() => {
      throw new Error("disk unavailable");
    });
    simulation.command({ id: "start", type: "start" });
    simulation.advance(200);
    const snapshot = simulation.snapshot();
    expect(snapshot.metrics.completed).toBeGreaterThan(0);
    expect(snapshot.metrics.archiveErrors).toBeGreaterThan(0);
    expect(snapshot.events.some((e) => e.message === "MUTATED")).toBe(false);
  });
  it("replays captured commands and decision records through speed changes and reset", () => {
    const source = new FactorySimulation({ seed: 1234 });
    const initial = source.exportRun();
    const entries: AuditEntry[] = [];
    source.subscribeEvents((e) => entries.push(e));
    source.command({ id: "start", type: "start" });
    source.advance(80);
    source.command({ id: "fast", type: "speed", value: 5 });
    source.advance(20);
    source.command({
      id: "profile",
      type: "profile",
      station: "exterior",
      value: "fast",
    });
    source.addDecision({
      id: "decision1",
      provider: "astra",
      time: source.snapshot().time,
      summary: "Recorded test fixture",
      status: "applied",
      latency: 2,
      commands: [
        { id: "profile", type: "profile", station: "exterior", value: "fast" },
      ],
      tokens: 20,
      revision: source.snapshot().revision,
    });
    source.advance(50);
    source.command({ id: "pause", type: "pause" });
    source.command({ id: "reset", type: "reset", scenario: "empty" });
    source.command({ id: "start2", type: "start" });
    source.advance(300);
    source.command({ id: "service", type: "repair", station: "front" });
    source.advance(200);
    const replay = replayArchive(initial, entries, source.snapshot().time);
    const a = source.snapshot(),
      b = replay.snapshot();
    a.metrics.simulationMs = b.metrics.simulationMs = 0;
    expect(b.metrics).toEqual(a.metrics);
    expect(b.vehicles).toEqual(a.vehicles);
    expect(b.stations).toEqual(a.stations);
    expect(b.providers).toEqual({ astra: false, jev: false });
  });
});
