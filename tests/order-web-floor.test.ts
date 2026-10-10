import { describe, expect, it } from "vitest";
import {
  agentOrderForVehicle,
  arrivals,
  newOrderMessage,
  parseLiveFrame,
  stepIndex,
  STEPPER,
} from "../apps/web/src/orderFloor.ts";
import type { DeskOrderCard } from "../packages/contracts/src/orders.ts";
import { agentA, config, createHarness } from "./helpers/order-harness.ts";

/** DF-ORDER-001 task 16 and 17: client validator and Orders tab helpers. */
describe("order floor web helpers", () => {
  it("accepts real snapshot and orders frames and rejects malformed orders frames", async () => {
    const h = createHarness();
    h.tick(20);
    const before = h.desk.deskView();
    const quote = await h.desk.quote(agentA, { config, quantity: 1, destinationZone: "zone-metro", leadOptions: ["standard", "expedite"] });
    const placed = h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "web-floor-0001" });
    h.tick(5);
    const desk = h.desk.deskView();
    const snapshotFrame = JSON.stringify({ type: "snapshot", sessionId: "order-floor", sequence: 1, sentAt: Date.now(), snapshot: h.sim.liveSnapshot() });
    const ordersFrame = { type: "orders", sessionId: "order-floor", sequence: 2, sentAt: Date.now(), desk };
    expect(parseLiveFrame(snapshotFrame).type).toBe("snapshot");
    const parsed = parseLiveFrame(JSON.stringify(ordersFrame));
    expect(parsed.type).toBe("orders");

    const malformed = [
      "{not json",
      JSON.stringify({ ...ordersFrame, type: "orders-v2" }),
      JSON.stringify({ ...ordersFrame, sessionId: "some-other-session" }),
      JSON.stringify({ ...ordersFrame, desk: { ...desk, virtual: false } }),
      JSON.stringify({ ...ordersFrame, desk: { ...desk, orders: [{ ...desk.orders[0], status: "teleported" }] } }),
      JSON.stringify({ ...ordersFrame, desk: { ...desk, orders: [{ ...desk.orders[0], price: { amount: 5, currency: "USD" } }] } }),
      JSON.stringify({ ...ordersFrame, desk: undefined }),
    ];
    for (const raw of malformed) expect(() => parseLiveFrame(raw)).toThrow();

    // Feed and toast text for the new arrival.
    const fresh = arrivals(before, desk);
    expect(fresh.map((card) => card.orderId)).toEqual([placed.order.orderId]);
    expect(newOrderMessage(fresh[0])).toBe(
      `New agent order ${placed.order.orderId} from Test agent A: 1 robotaxi, expedite, zone-metro.`,
    );
    expect(arrivals(null, desk)).toEqual([]);
    expect(arrivals(desk, desk)).toEqual([]);
  });

  it("maps statuses and unit stages onto the nine-step stepper", () => {
    const card = (status: DeskOrderCard["status"], stages: Array<DeskOrderCard["units"][number]["stage"]> = []) =>
      ({ status, units: stages.map((stage, index) => ({ index, status, stage, vehicleId: null, stations: {}, tracking: null })) }) as unknown as DeskOrderCard;
    expect(STEPPER).toHaveLength(9);
    expect(stepIndex(card("placed"))).toBe(0);
    expect(stepIndex(card("scheduled"))).toBe(1);
    expect(stepIndex(card("in_production", ["modules"]))).toBe(2);
    expect(stepIndex(card("in_production", ["joining"]))).toBe(3);
    expect(stepIndex(card("in_production", ["joining", "modules"]))).toBe(2);
    expect(stepIndex(card("quality_check"))).toBe(4);
    expect(stepIndex(card("ready_for_pickup"))).toBe(5);
    expect(stepIndex(card("shipped"))).toBe(6);
    expect(stepIndex(card("out_for_delivery"))).toBe(7);
    expect(stepIndex(card("delivered"))).toBe(8);
    expect(stepIndex(card("cancelled"))).toBe(-1);
  });

  it("links a floor vehicle back to its agent order for the Inspector row", async () => {
    const h = createHarness();
    h.tick(20);
    const quote = await h.desk.quote(agentA, { config, quantity: 1, destinationZone: "zone-local", leadOptions: ["standard"] });
    const placed = h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "web-floor-0002" });
    expect(h.until(() => h.desk.getOrder(agentA, placed.order.orderId).units[0].vehicleId !== null, 3000)).toBe(true);
    const desk = h.desk.deskView();
    const vehicleId = desk.orders[0].units[0].vehicleId!;
    const card = desk.orders[0];
    expect(card.units[0].stations.front?.binding).toBe("bound");
    expect(agentOrderForVehicle(desk, vehicleId)?.card.orderId).toBe(placed.order.orderId);
    expect(agentOrderForVehicle(desk, "vehicle-missing")).toBeNull();
    expect(agentOrderForVehicle(null, vehicleId)).toBeNull();
  });
});
