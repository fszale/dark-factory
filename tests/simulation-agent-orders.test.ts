import { describe, expect, it } from "vitest";
import {
  FactorySimulation,
  type AuditEntry,
} from "../packages/simulation/src/index.ts";
import { replayArchive } from "../packages/simulation/src/replay.ts";
import { commandSchema } from "../packages/contracts/src/index.ts";

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
const floor = () =>
  new FactorySimulation(
    { seed: 42, scenario: "balanced", continuous: true, orderSize: 2, dispatchDwell: 30 },
    "order-floor",
  );

describe("DF-ORDER-001 engine hooks", () => {
  it("creates agent orders with an external reference and validates the desk-only command", () => {
    const sim = floor();
    const created = sim.command({
      id: "agent-1",
      type: "order-agent-create",
      value: "2:3:ao-abcdefghij",
    });
    expect(created.ok).toBe(true);
    const order = sim.snapshot().orders.find((o) => o.source === "agent")!;
    expect(order).toMatchObject({
      quantity: 2,
      priority: 3,
      status: "queued",
      externalRef: "ao-abcdefghij",
    });
    expect(created.message).toBe(`Created ${order.id}`);
    const event = sim.snapshot().events.find(
      (e) => e.type === "order-created" && e.entity === order.id,
    )!;
    expect((event.data?.order as { externalRef: string }).externalRef).toBe(
      "ao-abcdefghij",
    );
    for (const [i, value] of [
      "4:3:ao-x",
      "0:3:ao-x",
      "1:1:ao-x",
      "1:6:ao-x",
      "1:3:",
      "1:3:BAD REF",
      "1:3",
    ].entries())
      expect(
        sim.command({ id: `bad-${i}`, type: "order-agent-create", value }).ok,
      ).toBe(false);
    expect(
      sim.command({
        id: "station",
        type: "order-agent-create",
        station: "front",
        value: "1:3:ao-other00000",
      }).ok,
    ).toBe(false);
    expect(
      sim.command({
        id: "duplicate-ref",
        type: "order-agent-create",
        value: "1:3:ao-abcdefghij",
      }).ok,
    ).toBe(false);
    expect(commandSchema.safeParse({ id: "x", type: "order-cancel", value: "order-1" }).success).toBe(true);
    conserve(sim);
  });

  it("cancels only queued, uncommitted orders and keeps the order ledger and checkpoint valid", () => {
    const sim = floor();
    sim.command({ id: "agent-1", type: "order-agent-create", value: "2:3:ao-cancel0001" });
    const order = sim.snapshot().orders.find((o) => o.source === "agent")!;
    const before = sim.snapshot().metrics;
    const cancelled = sim.command({ id: "cancel-1", type: "order-cancel", value: order.id });
    expect(cancelled).toMatchObject({ ok: true, message: `Cancelled ${order.id}` });
    const after = sim.snapshot();
    expect(after.orders.some((o) => o.id === order.id)).toBe(false);
    expect(after.metrics.ordersCancelled).toBe((before.ordersCancelled || 0) + 1);
    expect(after.metrics.orderedUnits).toBe(before.orderedUnits - 2);
    const event = after.events.find((e) => e.type === "order-cancelled")!;
    expect(event.entity).toBe(order.id);
    expect((event.data?.order as { externalRef: string; status: string })).toMatchObject({
      externalRef: "ao-cancel0001",
      status: "cancelled",
    });
    conserve(sim);
    expect(() => FactorySimulation.fromExport(sim.exportRun())).not.toThrow();
    expect(sim.command({ id: "cancel-again", type: "order-cancel", value: order.id }).ok).toBe(false);
    expect(sim.command({ id: "cancel-missing", type: "order-cancel", value: "order-999" }).ok).toBe(false);
    expect(sim.command({ id: "cancel-number", type: "order-cancel", value: 4 }).ok).toBe(false);
  });

  it("refuses to cancel after assembly-start and names the committed vehicle", () => {
    const sim = floor();
    sim.command({ id: "start", type: "start" });
    sim.command({ id: "agent-1", type: "order-agent-create", value: "1:2:ao-commit0001" });
    const order = sim.snapshot().orders.find((o) => o.source === "agent")!;
    for (let i = 0; i < 600 && !sim.snapshot().vehicles.some((v) => v.orderId === order.id); i++)
      sim.advance(1);
    const vehicle = sim.snapshot().vehicles.find((v) => v.orderId === order.id)!;
    expect(vehicle).toBeDefined();
    const refused = sim.command({ id: "late-cancel", type: "order-cancel", value: order.id });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain(vehicle.id);
    conserve(sim);
  });

  it("carries orderId on parking-route, vehicle-parked, dispatch-start and vehicle-dispatched", () => {
    const sim = floor();
    sim.command({ id: "start", type: "start" });
    sim.command({ id: "agent-1", type: "order-agent-create", value: "1:2:ao-events0001" });
    const order = sim.snapshot().orders.find((o) => o.source === "agent")!;
    const seen: Record<string, unknown> = {};
    sim.subscribeEvents((entry) => {
      if (entry.kind === "event" && entry.event.data?.orderId === order.id)
        seen[entry.event.type] = entry.event.data.orderId;
    });
    for (let i = 0; i < 900 && !seen["vehicle-dispatched"]; i++) sim.advance(1);
    for (const type of [
      "assembly-start",
      "vehicle-complete",
      "parking-route",
      "vehicle-parked",
      "dispatch-start",
      "vehicle-dispatched",
    ])
      expect(seen[type], type).toBe(order.id);
    conserve(sim);
  });

  it("round-trips externalRef through exportRun/fromExport and still imports old v1 checkpoints", () => {
    const sim = floor();
    sim.command({ id: "start", type: "start" });
    sim.advance(30);
    sim.command({ id: "agent-1", type: "order-agent-create", value: "3:3:ao-roundtrip1" });
    const restored = FactorySimulation.fromExport(sim.exportRun());
    expect(restored.snapshot().orders).toEqual(sim.snapshot().orders);
    expect(restored.snapshot().orders.some((o) => o.externalRef === "ao-roundtrip1")).toBe(true);
    // A checkpoint written before DF-ORDER-001 has no ordersCancelled metric and no agent fields.
    const legacy = new FactorySimulation({ continuous: false, orderSize: 2 }).exportRun();
    delete (legacy.snapshot.metrics as Record<string, number>).ordersCancelled;
    expect(() => FactorySimulation.fromExport(legacy)).not.toThrow();
  });

  it("replays a run with agent orders and a cancellation exactly", () => {
    const sim = floor(),
      initial = sim.exportRun(),
      archive: AuditEntry[] = [];
    sim.subscribeEvents((e) => archive.push(e));
    sim.command({ id: "start", type: "start" });
    sim.advance(40);
    sim.command({ id: "agent-1", type: "order-agent-create", value: "1:2:ao-replay0001" });
    sim.command({ id: "agent-2", type: "order-agent-create", value: "2:3:ao-replay0002" });
    sim.advance(20);
    const second = sim.snapshot().orders.find((o) => o.externalRef === "ao-replay0002")!;
    expect(sim.command({ id: "cancel-2", type: "order-cancel", value: second.id }).ok).toBe(true);
    sim.advance(600);
    const replay = replayArchive(initial, archive, sim.snapshot().time);
    expect(replay.snapshot().orders).toEqual(sim.snapshot().orders);
    expect(replay.snapshot().metrics.ordersCancelled).toBe(sim.snapshot().metrics.ordersCancelled);
    expect(replay.exportRun().internal.audit).toEqual(sim.exportRun().internal.audit);
    conserve(replay);
  });

  it("leaves finite-mode material conserved when an order is cancelled with modules in buffers", () => {
    const sim = new FactorySimulation({ continuous: false, orderSize: 1 });
    sim.command({ id: "agent-1", type: "order-agent-create", value: "1:4:ao-finite0001" });
    sim.command({ id: "start", type: "start" });
    sim.advance(60);
    const agent = sim.snapshot().orders.find((o) => o.source === "agent")!;
    expect(sim.command({ id: "cancel", type: "order-cancel", value: agent.id }).ok).toBe(true);
    sim.advance(900);
    expect(sim.snapshot().metrics.completed).toBe(1);
    conserve(sim);
    expect(() => FactorySimulation.fromExport(sim.exportRun())).not.toThrow();
  });
});
