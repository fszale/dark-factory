import { describe, it, expect } from "vitest";
import {
  FactorySimulation,
  type AuditEntry,
} from "../packages/simulation/src/index.ts";
import { replayArchive } from "../packages/simulation/src/replay.ts";
import {
  LINE_IDS,
  type ModuleInstance,
  type DecisionAftermath,
  type DecisionKpiSnapshot,
} from "../packages/contracts/src/index.ts";
const start = (sim: FactorySimulation) =>
  sim.command({ id: "run", type: "start" });
const conserve = (sim: FactorySimulation) => {
  const s = sim.snapshot();
  expect(s.metrics.initial + s.metrics.received).toBe(
    s.metrics.consumed +
      Object.values(s.warehouse).reduce((a, b) => a + b, 0) +
      Object.values(s.stations).reduce((a, b) => a + b.stock, 0) +
      s.carts.reduce((a, b) => a + b.amount, 0),
  );
};

describe("bounded material allocation and detailed genealogy", () => {
  it("changes the first actual cart allocation under a single shared loader and records policy provenance", () => {
    const baseline = new FactorySimulation({
      scenario: "empty",
      materialLoadingCapacity: 1,
    });
    const prioritized = new FactorySimulation({
      scenario: "empty",
      materialLoadingCapacity: 1,
    });
    expect(
      prioritized.command({
        id: "exterior-first",
        type: "priority",
        station: "exterior",
        value: 1,
      }).ok,
    ).toBe(true);
    start(baseline);
    start(prioritized);
    baseline.advance(44);
    prioritized.advance(44);
    expect(baseline.snapshot().carts.map((c) => c.line)).toEqual(["front"]);
    expect(prioritized.snapshot().carts.map((c) => c.line)).toEqual([
      "exterior",
    ]);
    expect(
      prioritized.snapshot().events.find((e) => e.type === "kit-pick")?.data,
    ).toMatchObject({
      priority: 1,
      loadingCapacity: 1,
      destination: "exterior",
      policy: "material-priority-then-line-order",
    });
    expect(
      prioritized.command({
        id: "rear-next",
        type: "priority",
        station: "rear",
        value: 1,
      }).ok,
    ).toBe(true);
    prioritized.advance(3);
    expect(
      prioritized.snapshot().carts.find((c) => c.phase === "loading")?.line,
    ).toBe("rear");
    prioritized.advance(120);
    expect(prioritized.snapshot().metrics.completed).toBeGreaterThan(0);
    conserve(prioritized);
  });
  it("enforces loader limits through contention and checkpoint continuation without rerouting kit families", () => {
    const sim = new FactorySimulation({
      scenario: "empty",
      materialLoadingCapacity: 2,
      materialPriority: {
        front: 4,
        rear: 5,
        battery: 1,
        interior: 2,
        exterior: 3,
      },
    });
    start(sim);
    sim.advance(44);
    expect(
      sim
        .snapshot()
        .carts.filter((c) => c.phase === "loading")
        .map((c) => c.line),
    ).toEqual(["battery", "interior"]);
    expect(
      sim.command({
        id: "shrink-busy",
        type: "config",
        value: "materialLoadingCapacity:1",
      }).ok,
    ).toBe(false);
    const invalid = sim.exportRun();
    invalid.snapshot.config.materialLoadingCapacity = 1;
    expect(() => FactorySimulation.fromExport(invalid)).toThrow(/loader/);
    const restored = FactorySimulation.fromExport(sim.exportRun());
    expect(restored.snapshot().config.materialPriority).toEqual(
      sim.snapshot().config.materialPriority,
    );
    restored.command({ id: "resume", type: "start" });
    for (let i = 0; i < 100; i++) {
      sim.advance(3);
      restored.advance(3);
      expect(
        sim.snapshot().carts.filter((c) => c.phase === "loading").length,
      ).toBeLessThanOrEqual(2);
    }
    expect(restored.snapshot().carts).toEqual(sim.snapshot().carts);
    expect(restored.snapshot().vehicles).toEqual(sim.snapshot().vehicles);
    conserve(sim);
    expect(
      sim.command({
        id: "invalid-priority",
        type: "priority",
        station: "front",
        value: 0,
      }).ok,
    ).toBe(false);
    expect(
      () => new FactorySimulation({ materialLoadingCapacity: 4 }),
    ).toThrow();
  });
  it("retains each inspection and rework timestamp through vehicle genealogy, archive, and checkpoint", () => {
    const sim = new FactorySimulation({
      profiles: {
        front: "fast",
        rear: "fast",
        battery: "fast",
        interior: "fast",
        exterior: "fast",
      },
    });
    const archive: AuditEntry[] = [];
    sim.subscribeEvents((e) => archive.push(e));
    start(sim);
    sim.advance(2400);
    const run = sim.exportRun(),
      audit = run.internal.audit as { modules: ModuleInstance[] }[];
    const repaired = audit
      .flatMap((v) => v.modules)
      .find((module) => module.rework === 1)!;
    expect(repaired).toBeDefined();
    expect(repaired.reworkHistory?.map((e) => e.event)).toEqual([
      "inspection-rejected",
      "rework-started",
      "inspection-passed",
    ]);
    expect(repaired.reworkHistory![2].time).toBeGreaterThan(
      repaired.reworkHistory![0].time,
    );
    expect(repaired.reworkHistory![0].time).toBeGreaterThan(repaired.created);
    const retired = archive
      .filter((e) => e.kind === "lineage")
      .flatMap((e) => e.lineage.modules as ModuleInstance[])
      .find((module) => module.id === repaired.id);
    expect(retired?.reworkHistory).toEqual(repaired.reworkHistory);
    expect(
      FactorySimulation.fromExport(run).exportRun().internal.audit,
    ).toEqual(run.internal.audit);
    const scrap = sim
      .snapshot()
      .events.find((e) => e.type === "module-scrapped");
    expect(scrap?.data?.reworkHistory).toHaveLength(4);
    for (const station of Object.values(run.snapshot.stations))
      for (const module of [
        ...station.queue,
        ...(station.current ? [station.current] : []),
      ])
        expect(module.reworkHistory?.length || 0).toBeLessThanOrEqual(4);
  });
  it("records and replays an observational decision aftermath without another provider call", () => {
    const sim = new FactorySimulation(),
      initial = sim.exportRun(),
      archive: AuditEntry[] = [];
    sim.subscribeEvents((e) => archive.push(e));
    start(sim);
    const baseline: DecisionKpiSnapshot = {
      time: 0,
      completed: 0,
      dispatched: 0,
      throughput: 0,
      yield: 100,
      energy: 0,
      dockWait: 0,
      assemblyWait: 0,
      parkingWait: 0,
      wip: 0,
      stock: 80,
    };
    sim.addDecision({
      id: "decision",
      provider: "astra",
      time: 0,
      summary: "Recorded test decision",
      status: "advisory",
      latency: 0,
      tokens: 0,
      commands: [],
      revision: sim.snapshot().revision,
      source: baseline,
      applicationTime: 0,
      commandResults: [],
    });
    sim.advance(120);
    const s = sim.snapshot(),
      measurement = {
        time: s.time,
        completed: s.metrics.completed,
        dispatched: s.metrics.dispatched,
        throughput: s.metrics.throughput,
        yield: s.metrics.yield,
        energy: s.metrics.energy,
        dockWait: s.metrics.dockWait,
        assemblyWait: s.metrics.assemblyWait,
        parkingWait: s.metrics.parkingWait,
        wip: s.metrics.wip,
        stock: s.metrics.warehouseOccupancy + s.metrics.stationStock,
      };
    const { time: _t, ...metrics } = measurement;
    const deltas = Object.fromEntries(
      Object.entries(metrics).map(([key, value]) => [
        key,
        value - baseline[key as keyof typeof metrics],
      ]),
    ) as DecisionAftermath["deltas"];
    const aftermath: DecisionAftermath = {
      status: "complete",
      windowSeconds: 120,
      baseline,
      measurement,
      deltas,
      interpretation: "observational-not-causal",
    };
    expect(sim.updateDecisionAftermath("decision", aftermath)).toBe(true);
    expect(sim.updateDecisionAftermath("missing", aftermath)).toBe(false);
    expect(
      archive.some(
        (e) => e.kind === "event" && e.event.type === "ai-aftermath",
      ),
    ).toBe(true);
    const replay = replayArchive(initial, archive, 120);
    expect(replay.snapshot().decisions[0].aftermath).toEqual(aftermath);
    expect(
      FactorySimulation.fromExport(sim.exportRun()).snapshot().decisions[0]
        .aftermath,
    ).toEqual(aftermath);
    expect(replay.snapshot().providers).toEqual({ astra: false, jev: false });
  });
});
