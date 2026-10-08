import { describe, expect, it } from "vitest";
import { orderDeskViewSchema, orderUpdate, orderView, quoteVehicleOutput } from "../packages/contracts/src/orders.ts";
import { OrderDesk, OrderDeskError } from "../packages/orders/src/desk.ts";
import { rebuildDesk } from "../packages/orders/src/replay.ts";
import { agentA, agentB, config, createHarness } from "./helpers/order-harness.ts";

const quoteInput = (quantity = 1, zone = "zone-local") => ({
  config,
  quantity,
  destinationZone: zone,
  leadOptions: ["standard", "expedite"] as Array<"standard" | "expedite">,
});

async function expectCode(promise: Promise<unknown> | (() => unknown), code: string) {
  try {
    if (typeof promise === "function") promise();
    else await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OrderDeskError);
    expect((error as OrderDeskError).code).toBe(code);
    return error as OrderDeskError;
  }
  throw new Error(`expected ${code}`);
}

describe("order desk end to end on a real floor", () => {
  it("quotes, places, follows production, ships and delivers a virtual order", async () => {
    const h = createHarness();
    h.tick(30);
    const quote = await h.desk.quote(agentA, quoteInput(1));
    expect(quoteVehicleOutput.parse(quote)).toBeTruthy();
    expect(quote.feasibility.manufacturable).toBe(true);
    const standard = quote.leadOptions.find((o) => o.name === "standard")!;
    expect(standard.shipBySimTime).toBeGreaterThan(quote.basis.simTime);
    expect(standard.price.amount).toBeGreaterThan(0);
    const placed = h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "place-0001" });
    expect(orderView.parse(placed.order)).toBeTruthy();
    expect(placed.order.status).toBe("scheduled");
    expect(placed.order.factoryOrderId).toMatch(/^order-\d+$/);
    const delivered = h.until(() => h.desk.getOrder(agentA, placed.order.orderId).status === "delivered", 6000);
    expect(h.sim.snapshot().metrics.archiveErrors ?? 0).toBe(0);
    expect(delivered).toBe(true);
    const feed = h.desk.updatesFor(agentA, { orderId: placed.order.orderId, limit: 100 });
    const types = feed.updates.map((u) => u.type);
    for (const u of feed.updates) orderUpdate.parse(u);
    expect(types[0]).toBe("order.placed");
    for (const expected of ["order.accepted", "order.scheduled", "unit.committed", "unit.joined", "unit.passed", "order.completed", "unit.staging", "unit.parked", "unit.dispatch_started", "unit.shipped", "carrier.out_for_delivery", "unit.delivered", "order.delivered"])
      expect(types).toContain(expected);
    expect(types.at(-1)).toBe("order.delivered");
    const shipped = feed.updates.find((u) => u.type === "unit.shipped")!;
    // Quote promise matches the actual run exactly when nothing else changes (same quantum, same seed).
    expect(shipped.simTime).toBeCloseTo(standard.shipBySimTime!, 6);
    const view = h.desk.getOrder(agentA, placed.order.orderId);
    expect(view.units[0].tracking?.trackingId).toBe(`bvf-${placed.order.orderId}-0`);
    expect(Object.values(view.units[0].stations).every((s) => s.binding === "bound" && s.moduleId)).toBe(true);
    expect(orderDeskViewSchema.parse(h.desk.deskView()).metrics.delivered).toBe(1);
  }, 60_000);

  it("replays idempotent placement and rejects key reuse with a different request", async () => {
    const h = createHarness();
    h.tick(10);
    const quote = await h.desk.quote(agentA, quoteInput(1));
    const first = h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "same-key-01" });
    const again = h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "same-key-01" });
    expect(again.replayed).toBe(true);
    expect(again.order.orderId).toBe(first.order.orderId);
    expect(h.sim.snapshot().orders.filter((o) => o.source === "agent")).toHaveLength(1);
    await expectCode(() => h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "same-key-01" }), "IDEMPOTENCY_KEY_REUSED");
    await expectCode(() => h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "other-key-01" }), "QUOTE_EXPIRED");
  });

  it("rejects missing, foreign, expired, stale-epoch, infeasible and unquoted lead options", async () => {
    const h = createHarness();
    h.tick(5);
    await expectCode(() => h.desk.placeOrder(agentA, { quoteId: "aq-zzzzzzzzzz", leadOption: "standard", idempotencyKey: "k-missing-1" }), "QUOTE_NOT_FOUND");
    const quote = await h.desk.quote(agentA, quoteInput(1));
    await expectCode(() => h.desk.placeOrder(agentB, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "k-foreign-1" }), "QUOTE_NOT_FOUND");
    const onlyStandard = await h.desk.quote(agentA, { ...quoteInput(1), leadOptions: ["standard"] });
    await expectCode(() => h.desk.placeOrder(agentA, { quoteId: onlyStandard.quoteId, leadOption: "expedite", idempotencyKey: "k-unquoted" }), "VALIDATION_FAILED");
    h.setWall(h.wall() + 11 * 60_000);
    await expectCode(() => h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "k-expired-1" }), "QUOTE_EXPIRED");
    const fresh = await h.desk.quote(agentA, quoteInput(1));
    expect(h.sim.command({ id: "reset-1", type: "reset" }).ok).toBe(true);
    await expectCode(() => h.desk.placeOrder(agentA, { quoteId: fresh.quoteId, leadOption: "standard", idempotencyKey: "k-epoch-01" }), "QUOTE_EXPIRED");
    h.sim.command({ id: "start-2", type: "start" });
    const bad = await h.desk.quote(agentA, { config: { modelId: "robotaxi-gold-two-seat", options: { finish: "silver", seats: 4 } }, quantity: 5, destinationZone: "mars", leadOptions: ["standard"] });
    expect(bad.feasibility.manufacturable).toBe(false);
    expect(bad.feasibility.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["OPTION_NOT_OFFERED", "QUANTITY_ABOVE_LIMIT", "ZONE_UNKNOWN"]));
    expect(bad.leadOptions[0].shipBySimTime).toBeNull();
    const error = await expectCode(() => h.desk.placeOrder(agentA, { quoteId: bad.quoteId, leadOption: "standard", idempotencyKey: "k-infeasible" }), "QUOTE_INFEASIBLE");
    expect(error.body().error.issues?.length).toBeGreaterThan(0);
  });

  it("enforces ownership, per-agent caps, floor caps and the intake pause", async () => {
    const h = createHarness({ maxActiveAgentOrders: 2 });
    h.tick(5);
    const capped = { ...agentA, maxActiveOrders: 1 };
    const q1 = await h.desk.quote(capped, quoteInput(1));
    const q2 = await h.desk.quote(capped, quoteInput(1));
    const order = h.desk.placeOrder(capped, { quoteId: q1.quoteId, leadOption: "standard", idempotencyKey: "cap-key-01" }).order;
    await expectCode(() => h.desk.placeOrder(capped, { quoteId: q2.quoteId, leadOption: "standard", idempotencyKey: "cap-key-02" }), "AGENT_ORDER_CAP");
    await expectCode(() => h.desk.getOrder(agentB, order.orderId), "ORDER_NOT_FOUND");
    expect(h.desk.listOrders(agentB, {}).orders).toHaveLength(0);
    expect(h.desk.updatesFor(agentB, {}).updates).toHaveLength(0);
    const qb1 = await h.desk.quote(agentB, quoteInput(1));
    const qb2 = await h.desk.quote(agentB, quoteInput(1));
    h.desk.placeOrder(agentB, { quoteId: qb1.quoteId, leadOption: "standard", idempotencyKey: "floor-key-1" });
    await expectCode(() => h.desk.placeOrder(agentB, { quoteId: qb2.quoteId, leadOption: "standard", idempotencyKey: "floor-key-2" }), "FLOOR_FULL");
    h.desk.setIntakePaused(true);
    const paused = await h.desk.quote(agentB, quoteInput(1));
    expect(paused.feasibility.issues.map((i) => i.code)).toContain("ORDER_DESK_PAUSED");
    await expectCode(() => h.desk.placeOrder(agentB, { quoteId: qb2.quoteId, leadOption: "standard", idempotencyKey: "floor-key-3" }), "ORDER_DESK_PAUSED");
  });

  it("cancels before commitment and refuses after, naming the vehicle", async () => {
    const h = createHarness();
    h.tick(5);
    // A visitor order ahead keeps the agent order queued long enough to cancel.
    const q = await h.desk.quote(agentA, quoteInput(1));
    const order = h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "standard", idempotencyKey: "cancel-k-1" }).order;
    const cancelled = h.desk.cancelOrder(agentA, { orderId: order.orderId, idempotencyKey: "cancel-k-2" });
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.order.status).toBe("cancelled");
    expect(h.sim.snapshot().orders.some((o) => o.id === order.factoryOrderId)).toBe(false);
    expect(h.sim.snapshot().metrics.ordersCancelled).toBe(1);
    expect(h.desk.cancelOrder(agentA, { orderId: order.orderId, idempotencyKey: "cancel-k-2" }).replayed).toBe(true);
    const q2 = await h.desk.quote(agentA, quoteInput(2));
    const second = h.desk.placeOrder(agentA, { quoteId: q2.quoteId, leadOption: "expedite", idempotencyKey: "cancel-k-3" }).order;
    expect(h.until(() => h.desk.getOrder(agentA, second.orderId).units[0].vehicleId !== null)).toBe(true);
    const vehicle = h.desk.getOrder(agentA, second.orderId).units[0].vehicleId!;
    const refused = await expectCode(() => h.desk.cancelOrder(agentA, { orderId: second.orderId, idempotencyKey: "cancel-k-4" }), "CANCEL_NOT_ALLOWED");
    expect(refused.message).toContain(vehicle);
    expect(h.desk.getOrder(agentA, second.orderId).status).not.toBe("cancelled");
    await expectCode(() => h.desk.cancelOrder(agentB, { orderId: second.orderId, idempotencyKey: "cancel-k-5" }), "ORDER_NOT_FOUND");
  });

  it("raises and clears at-risk on faults and pauses, and projects queue-head station progress", async () => {
    const h = createHarness();
    h.tick(5);
    const q = await h.desk.quote(agentA, quoteInput(1));
    const order = h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "expedite", idempotencyKey: "risk-k-01" }).order;
    expect(h.sim.command({ id: "f1", type: "fault", value: "supply" }).ok).toBe(true);
    let view = h.desk.getOrder(agentA, order.orderId);
    expect(view.atRisk).toEqual({ value: true, reasons: ["site_fault:supply"] });
    expect(view.statusReason).toBe("site_fault:supply");
    expect(h.sim.command({ id: "r1", type: "repair" }).ok).toBe(true);
    view = h.desk.getOrder(agentA, order.orderId);
    expect(view.atRisk.value).toBe(false);
    const types = h.desk.updatesFor(agentA, { orderId: order.orderId }).updates.map((u) => u.type);
    expect(types).toEqual(expect.arrayContaining(["order.at_risk", "order.risk_cleared"]));
    const projected = Object.values(view.units[0].stations);
    expect(projected.every((s) => s.binding === "projected" && s.moduleId === null)).toBe(true);
    if (view.units[0].stage === "modules") expect(projected.some((s) => s.state !== "waiting")).toBe(true);
  });

  it("drives carrier hold, release and test-only loss", async () => {
    const h = createHarness({ deliveryTimeScale: 1 });
    h.tick(5);
    const q = await h.desk.quote(agentA, quoteInput(2, "zone-remote"));
    const order = h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "expedite", idempotencyKey: "carrier-k1" }).order;
    expect(h.until(() => h.desk.getOrder(agentA, order.orderId).units.every((u) => u.tracking !== null), 6000)).toBe(true);
    const before = h.desk.getOrder(agentA, order.orderId).units[0].tracking!.etaSimTime!;
    expect(h.desk.carrierControl("carrier-hold", order.orderId, 0)).toBe(true);
    h.tick(40);
    expect(h.desk.carrierControl("carrier-release", order.orderId, 0)).toBe(true);
    const after = h.desk.getOrder(agentA, order.orderId).units[0].tracking!.etaSimTime!;
    expect(after - before).toBeGreaterThanOrEqual(39);
    const updates = h.desk.updatesFor(agentA, { orderId: order.orderId, limit: 100 }).updates;
    expect(updates.some((u) => u.type === "carrier.delayed" && u.data?.reason === "virtual-operator-hold")).toBe(true);
    expect(updates.some((u) => u.type === "carrier.recovered")).toBe(true);
    expect(h.desk.carrierControl("carrier-lose", order.orderId, 1)).toBe(true);
    const failed = h.desk.getOrder(agentA, order.orderId);
    expect(failed.status).toBe("failed");
    expect(failed.statusReason).toBe("carrier_lost");
    await expectCode(() => h.desk.carrierControl("carrier-hold", order.orderId, 0), "ORDER_NOT_FOUND");
  }, 60_000);

  it("pages list_orders and the update feed with stable cursors and expires pruned cursors", async () => {
    const h = createHarness();
    h.tick(5);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const q = await h.desk.quote(agentA, quoteInput(1));
      ids.push(h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "standard", idempotencyKey: `page-key-${i}` }).order.orderId);
    }
    const page1 = h.desk.listOrders(agentA, { limit: 2 });
    expect(page1.orders.map((o) => o.orderId)).toEqual([ids[2], ids[1]]);
    const page2 = h.desk.listOrders(agentA, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.orders.map((o) => o.orderId)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    expect(h.desk.listOrders(agentA, { status: ["delivered"] }).orders).toHaveLength(0);
    await expectCode(() => h.desk.listOrders(agentA, { cursor: "bogus" }), "VALIDATION_FAILED");
    const feed1 = h.desk.updatesFor(agentA, { limit: 3 });
    expect(feed1.hasMore).toBe(true);
    const feed2 = h.desk.updatesFor(agentA, { cursor: feed1.nextCursor, limit: 100 });
    expect(feed2.updates[0].seq).toBeGreaterThan(feed1.updates.at(-1)!.seq);
    const idle = h.desk.updatesFor(agentA, { cursor: feed2.nextCursor });
    expect(idle.updates).toHaveLength(0);
    expect(idle.nextCursor).toBe(feed2.nextCursor);
    // Force pruning: a desk state with a dropped prefix rejects a cursor before it.
    const state = h.desk.serialize();
    state.orders[ids[0]].droppedThrough = 2;
    state.updates = state.updates.filter((u) => u.seq > 2);
    const restored = new OrderDesk({ floor: h.port, now: () => h.wall() }, state);
    await expectCode(() => restored.updatesFor(agentA, { orderId: ids[0], cursor: "u0" }), "CURSOR_EXPIRED");
  });

  it("re-forecasts active orders and emits estimate.revised with forecast source", async () => {
    const h = createHarness({ reforecastIntervalMs: 0 });
    h.tick(5);
    const q = await h.desk.quote(agentA, quoteInput(1));
    const order = h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "standard", idempotencyKey: "fc-key-001" }).order;
    h.tick(2);
    expect(h.sim.command({ id: "slow", type: "fault", station: "front", value: "test fault" }).ok).toBe(true);
    expect(h.desk.needsReforecast()).toBe(true);
    expect(await h.desk.reforecast()).toBe(1);
    const revised = h.desk.updatesFor(agentA, { orderId: order.orderId, limit: 100 }).updates.filter((u) => u.type === "estimate.revised");
    expect(revised).toHaveLength(1);
    expect(revised[0].source).toBe("forecast");
    expect(h.desk.getOrder(agentA, order.orderId).latestEstimate.confidence).not.toBe("firm-if-no-new-inputs");
  });

  it("fails active orders on a floor reset and on reconcile after lost floor state", async () => {
    const h = createHarness();
    h.tick(5);
    const q = await h.desk.quote(agentA, quoteInput(1));
    const order = h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "standard", idempotencyKey: "reset-k-01" }).order;
    const saved = h.desk.serialize();
    h.sim.command({ id: "reset-x", type: "reset" });
    expect(h.desk.getOrder(agentA, order.orderId)).toMatchObject({ status: "failed", statusReason: "floor_reset" });
    const restored = new OrderDesk({ floor: h.port, now: () => h.wall() }, saved);
    expect(restored.reconcile(h.sim.snapshot())).toBe(1);
    expect(restored.getOrder(agentA, order.orderId)).toMatchObject({ status: "failed", statusReason: "floor_state_lost" });
  });

  it("marks injection failed when the engine refuses the order (20-order cap)", async () => {
    const h = createHarness();
    h.tick(5);
    const q = await h.desk.quote(agentA, quoteInput(1));
    // Race: visitors fill the engine between the desk's feasibility re-check and injection.
    const forward = h.port.command;
    h.port.command = (command) => {
      if (command.type === "order-agent-create")
        for (let i = h.sim.snapshot().orders.length; i < 20; i++) h.sim.command({ id: `fill-${i}`, type: "order-create", value: "1:3" });
      return forward(command);
    };
    const placed = h.desk.placeOrder(agentA, { quoteId: q.quoteId, leadOption: "standard", idempotencyKey: "inject-k1" }).order;
    expect(h.sim.snapshot().orders).toHaveLength(20);
    expect(placed).toMatchObject({ status: "failed", statusReason: "injection_rejected", factoryOrderId: null });
    const types = h.desk.updatesFor(agentA, { orderId: placed.orderId }).updates.map((u) => u.type);
    expect(types).toEqual(["order.placed", "order.accepted", "order.failed"]);
  });

  it("rebuilds the same simulated update log from the floor archive and is deterministic across wall clocks", async () => {
    const run = async (wallOffset: number) => {
      const h = createHarness({ deliveryTimeScale: 0.2 });
      h.setWall(h.wall() + wallOffset);
      const checkpoint = h.sim.snapshot();
      const archive: Array<unknown> = [];
      h.sim.subscribeEvents((entry) => archive.push(entry));
      const origRecord = h.records.push.bind(h.records);
      h.records.push = (...items) => {
        archive.push(...items);
        return origRecord(...items);
      };
      h.tick(5);
      const q1 = await h.desk.quote(agentA, quoteInput(2, "zone-metro"));
      const a = h.desk.placeOrder(agentA, { quoteId: q1.quoteId, leadOption: "standard", idempotencyKey: "det-key-01" }).order;
      const q2 = await h.desk.quote(agentB, quoteInput(1));
      const b = h.desk.placeOrder(agentB, { quoteId: q2.quoteId, leadOption: "expedite", idempotencyKey: "det-key-02" }).order;
      h.desk.cancelOrder(agentB, { orderId: b.orderId, idempotencyKey: "det-key-03" });
      h.sim.command({ id: "det-fault", type: "fault", value: "congestion" });
      h.tick(20);
      h.sim.command({ id: "det-repair", type: "repair" });
      h.until(() => h.desk.getOrder(agentA, a.orderId).units.every((u) => u.tracking !== null), 6000);
      h.desk.carrierControl("carrier-hold", a.orderId, 0);
      h.tick(10);
      h.desk.carrierControl("carrier-release", a.orderId, 0);
      h.until(() => h.desk.getOrder(agentA, a.orderId).status === "delivered", 6000);
      const rebuilt = rebuildDesk(checkpoint, archive as never, { now: () => 0, seed: 42, deliveryTimeScale: 0.2, endSimTime: h.sim.snapshot().time });
      return { live: h.desk.updateLogDigest(), rebuilt: rebuilt.updateLogDigest(), status: h.desk.getOrder(agentA, a.orderId).status };
    };
    const first = await run(0);
    const second = await run(3_600_000);
    expect(first.status).toBe("delivered");
    expect(first.rebuilt).toBe(first.live);
    expect(second.live).toBe(first.live);
  }, 120_000);
});
