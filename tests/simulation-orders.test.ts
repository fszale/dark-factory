import { describe, it, expect } from "vitest";
import {
  FactorySimulation,
  type AuditEntry,
} from "../packages/simulation/src/index.ts";
import { replayArchive } from "../packages/simulation/src/replay.ts";
import { ROBOTAXI_RECIPE } from "../packages/assets/src/design.ts";
const run = (sim: FactorySimulation) =>
  sim.command({ id: "start-orders", type: "start" });
const conserve = (sim: FactorySimulation) => {
  const s = sim.snapshot();
  expect(s.metrics.initial + s.metrics.received).toBe(
    s.metrics.consumed +
      Object.values(s.warehouse).reduce((a, b) => a + b, 0) +
      Object.values(s.stations).reduce((a, b) => a + b.stock, 0) +
      s.carts.reduce((a, b) => a + b.amount, 0),
  );
  expect(
    s.orders.reduce((total, o) => total + o.quantity - o.completed, 0),
  ).toBe(s.metrics.orderedUnits - s.metrics.completed);
};
describe("bounded production orders", () => {
  it("selects a promoted order at atomic joining, follows recipe order, and never preempts committed work", () => {
    const sim = new FactorySimulation({ continuous: false, orderSize: 2 });
    const original = sim.snapshot().orders[0].id;
    expect(
      sim.command({ id: "rush", type: "order-create", value: "1:5" }).ok,
    ).toBe(true);
    const rush = sim.snapshot().orders.find((o) => o.source === "manual")!.id;
    expect(
      sim.command({ id: "promote", type: "order-priority", value: `${rush}:1` })
        .ok,
    ).toBe(true);
    run(sim);
    for (let i = 0; i < 200 && !sim.snapshot().vehicles.length; i++)
      sim.advance(1);
    const committed = sim.snapshot().vehicles[0];
    expect(committed.orderId).toBe(rush);
    expect(committed.modules.map((m) => m.line)).toEqual(
      ROBOTAXI_RECIPE.joiningOrder,
    );
    expect(
      sim.command({
        id: "demote-rush",
        type: "order-priority",
        value: `${rush}:5`,
      }).ok,
    ).toBe(true);
    expect(
      sim.command({
        id: "promote-original",
        type: "order-priority",
        value: `${original}:1`,
      }).ok,
    ).toBe(true);
    expect(sim.snapshot().vehicles[0].orderId).toBe(rush);
    const rushBefore = sim.snapshot().orders.find((o) => o.id === rush)!;
    expect(rushBefore.completed).toBe(0);
    sim.advance(1600);
    expect(sim.snapshot().metrics.completed).toBe(3);
    expect(sim.snapshot().metrics.dispatched).toBe(3);
    expect(sim.snapshot().orders).toEqual([]);
    expect(sim.snapshot().metrics.ordersCompleted).toBe(2);
    const joins = sim
      .snapshot()
      .events.filter((e) => e.type === "assembly-start");
    expect(joins.map((e) => e.data?.orderId)).toEqual([
      rush,
      original,
      original,
    ]);
    expect(
      (sim.exportRun().internal.audit as { orderId: string }[]).map(
        (v) => v.orderId,
      ),
    ).toContain(rush);
    conserve(sim);
  });
  it("bounds active requests, rejects malformed production priorities, and keeps station priorities separate", () => {
    const sim = new FactorySimulation({ continuous: false });
    for (let i = 0; i < 19; i++)
      expect(
        sim.command({ id: `new-${i}`, type: "order-create", value: "2:3" }).ok,
      ).toBe(true);
    expect(sim.snapshot().orders).toHaveLength(20);
    expect(
      sim.command({ id: "full", type: "order-create", value: "1:1" }).ok,
    ).toBe(false);
    for (const [i, value] of [
      "0:1",
      "1001:1",
      "2:0",
      "2:6",
      "2.5:2",
      "2:3:4",
    ].entries())
      expect(
        sim.command({ id: `bad-${i}`, type: "order-create", value }).ok,
      ).toBe(false);
    expect(
      sim.command({
        id: "wrong-target",
        type: "order-priority",
        station: "front",
        value: "front:1",
      }).ok,
    ).toBe(false);
    expect(
      sim.command({
        id: "line-priority",
        type: "priority",
        station: "front",
        value: 1,
      }).ok,
    ).toBe(true);
    expect(sim.snapshot().orders.every((o) => o.priority === 3)).toBe(true);
    conserve(sim);
  });
  it("continues a checkpoint with committed order ownership and rejects inconsistent order ledgers", () => {
    const sim = new FactorySimulation({ continuous: false, orderSize: 3 });
    run(sim);
    sim.advance(60);
    const saved = sim.exportRun(),
      restored = FactorySimulation.fromExport(saved);
    expect(restored.snapshot().orders).toEqual(sim.snapshot().orders);
    expect(restored.snapshot().vehicles).toEqual(sim.snapshot().vehicles);
    restored.command({ id: "resume-order", type: "start" });
    sim.advance(1200);
    restored.advance(1200);
    expect(restored.snapshot().metrics.completed).toBe(3);
    expect(restored.exportRun().internal.audit).toEqual(
      sim.exportRun().internal.audit,
    );
    const invalid = structuredClone(saved);
    invalid.snapshot.orders[0].quantity++;
    expect(() => FactorySimulation.fromExport(invalid)).toThrow(/order/);
    const orphan = structuredClone(saved);
    orphan.snapshot.vehicles[0].orderId = "unknown";
    expect(() => FactorySimulation.fromExport(orphan)).toThrow(/order/);
    conserve(restored);
  });
  it("migrates older v1 checkpoints without explicit orders, preserving finite demand", () => {
    const sim = new FactorySimulation({ continuous: false, orderSize: 3 });
    run(sim);
    sim.advance(60);
    const legacy = sim.exportRun();
    delete (legacy.snapshot as any).orders;
    for (const vehicle of legacy.snapshot.vehicles) delete vehicle.orderId;
    delete legacy.snapshot.metrics.orderedUnits;
    const restored = FactorySimulation.fromExport(legacy);
    expect(restored.snapshot().orders[0].id).toBe("order-legacy");
    restored.command({ id: "resume-legacy", type: "start" });
    restored.advance(1200);
    expect(restored.snapshot().metrics.completed).toBe(3);
    conserve(restored);
  });
  it("retains complete order events and genealogy while rolling showcase orders stay bounded", () => {
    const sim = new FactorySimulation({ orderSize: 1 }),
      archive: AuditEntry[] = [];
    sim.subscribeEvents((e) => archive.push(e));
    run(sim);
    for (let i = 0; i < 120; i++) {
      sim.advance(60);
      expect(sim.snapshot().orders.length).toBeLessThanOrEqual(1);
      conserve(sim);
    }
    const s = sim.snapshot();
    expect(s.metrics.completed).toBeGreaterThan(100);
    expect(s.metrics.ordersCompleted).toBe(s.metrics.completed);
    expect(
      archive.filter(
        (e) => e.kind === "event" && e.event.type === "order-completed",
      ),
    ).toHaveLength(s.metrics.completed);
    expect(
      archive
        .filter((e) => e.kind === "lineage")
        .every((e) => typeof e.lineage.orderId === "string"),
    ).toBe(true);
    expect(() => FactorySimulation.fromExport(sim.exportRun())).not.toThrow();
  });
  it("replays an identical recorded order-priority schedule without additional model calls", () => {
    const sim = new FactorySimulation({ continuous: false, orderSize: 2 }),
      initial = sim.exportRun(),
      archive: AuditEntry[] = [];
    sim.subscribeEvents((e) => archive.push(e));
    run(sim);
    sim.advance(30);
    sim.command({ id: "create-rush", type: "order-create", value: "2:1" });
    sim.advance(1200);
    const replay = replayArchive(initial, archive, sim.snapshot().time);
    expect(replay.snapshot().orders).toEqual(sim.snapshot().orders);
    expect(replay.exportRun().internal.audit).toEqual(
      sim.exportRun().internal.audit,
    );
    expect(replay.snapshot().metrics.completed).toBe(4);
  });
});
