import { describe, expect, it } from "vitest";
import {
  agentReference,
  cancelOrderInput,
  getOrderInput,
  getOrderUpdatesInput,
  listOrdersInput,
  orderDeskError,
  orderDeskViewSchema,
  orderUpdate,
  orderView,
  placeOrderInput,
  quoteVehicleInput,
  quoteVehicleOutput,
  virtualAmount,
  VIRTUAL_DISCLAIMER,
} from "../packages/contracts/src/orders.ts";
import {
  checkpointSchema,
  ordersMessageSchema,
  productionOrderSchema,
} from "../packages/contracts/src/runtime.ts";

const quoteInput = {
  config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold" } },
  quantity: 1,
  destinationZone: "zone-local",
};
const amount = (value: number) => ({ amount: value, currency: "BWC-VIRTUAL" as const });
const estimate = {
  completeBySimTime: 247,
  shipBySimTime: 314.4,
  deliverBySimTime: 434.4,
  estimatedDeliveryAt: "2026-10-08T12:00:00.000Z",
};
const station = { state: "waiting", binding: "projected", moduleId: null, lot: null, rework: null, history: [] };
const exampleOrder = {
  orderId: "ao-7k2m9q4x1c",
  agentId: "test-agent",
  quoteId: "aq-7k2m9q4x1c",
  status: "scheduled",
  statusReason: null,
  atRisk: { value: false, reasons: [] },
  config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold", seats: 2 } },
  quantity: 1,
  destinationZone: "zone-local",
  leadOption: "expedite",
  price: amount(1270),
  agentReference: "po-42",
  placedAt: "2026-10-08T12:00:00.000Z",
  placedAtSimTime: 200,
  factoryOrderId: "order-7",
  promised: estimate,
  latestEstimate: { ...estimate, confidence: "firm-if-no-new-inputs" },
  units: [
    {
      index: 0,
      status: "scheduled",
      stage: "queued",
      vehicleId: null,
      stations: { front: station, rear: station, battery: station, interior: station, exterior: station },
      tracking: null,
    },
  ],
  lastUpdateSeq: 3,
  virtual: true,
  disclaimer: VIRTUAL_DISCLAIMER,
};

describe("DF-ORDER-001 contracts", () => {
  it("accepts the documented examples", () => {
    expect(quoteVehicleInput.parse(quoteInput).leadOptions).toEqual(["standard", "expedite"]);
    expect(placeOrderInput.safeParse({ quoteId: "aq-7k2m9q4x1c", leadOption: "expedite", idempotencyKey: "scenario-standard-1" }).success).toBe(true);
    expect(orderView.safeParse(exampleOrder).success).toBe(true);
    expect(getOrderInput.safeParse({ orderId: "ao-7k2m9q4x1c" }).success).toBe(true);
    expect(listOrdersInput.parse({}).limit).toBe(20);
    expect(getOrderUpdatesInput.parse({}).waitSeconds).toBe(0);
    expect(cancelOrderInput.safeParse({ orderId: "ao-7k2m9q4x1c", idempotencyKey: "cancel-0001" }).success).toBe(true);
    expect(
      orderUpdate.safeParse({
        seq: 1,
        orderId: "ao-7k2m9q4x1c",
        unitIndex: null,
        type: "order.placed",
        status: "placed",
        previousStatus: null,
        at: "2026-10-08T12:00:00.000Z",
        simTime: 200,
        message: "Order placed.",
        factoryEvent: null,
        source: "simulated",
      }).success,
    ).toBe(true);
    expect(orderDeskError.safeParse({ error: { code: "QUOTE_EXPIRED", message: "Quote expired.", retryable: false } }).success).toBe(true);
  });

  it("rejects unknown keys, including payment, address and contact fields", () => {
    for (const extra of [{ payment: { card: "x" } }, { address: "1 Main" }, { phone: "555" }, { email: "a@b.c" }]) {
      expect(quoteVehicleInput.safeParse({ ...quoteInput, ...extra }).success).toBe(false);
      expect(placeOrderInput.safeParse({ quoteId: "aq-7k2m9q4x1c", leadOption: "standard", idempotencyKey: "abcdefgh", ...extra }).success).toBe(false);
      expect(cancelOrderInput.safeParse({ orderId: "ao-7k2m9q4x1c", idempotencyKey: "abcdefgh", ...extra }).success).toBe(false);
    }
    expect(quoteVehicleInput.safeParse({ ...quoteInput, config: { ...quoteInput.config, color: "red" } }).success).toBe(false);
    expect(virtualAmount.safeParse({ amount: 1, currency: "USD" }).success).toBe(false);
    expect(virtualAmount.safeParse({ amount: 1, currency: "BWC-VIRTUAL", card: "4111" }).success).toBe(false);
  });

  it("rejects PII-looking agent references", () => {
    for (const bad of ["me@example.com", "https://x.test", "two words", "call 5551234567", "acct1234567", "a/b", "a+b", "x".repeat(65)])
      expect(agentReference.safeParse(bad).success, bad).toBe(false);
    for (const good of ["po-42", "batch_7.alpha:3", "", "run-123456"])
      expect(agentReference.safeParse(good).success, good).toBe(true);
  });

  it("rejects bad ids and out-of-range values", () => {
    expect(getOrderInput.safeParse({ orderId: "order-7" }).success).toBe(false);
    expect(getOrderInput.safeParse({ orderId: "ao-UPPERCASE1" }).success).toBe(false);
    expect(placeOrderInput.safeParse({ quoteId: "aq-short", leadOption: "standard", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(placeOrderInput.safeParse({ quoteId: "aq-7k2m9q4x1c", leadOption: "overnight", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(placeOrderInput.safeParse({ quoteId: "aq-7k2m9q4x1c", leadOption: "standard", idempotencyKey: "short" }).success).toBe(false);
    expect(placeOrderInput.safeParse({ quoteId: "aq-7k2m9q4x1c", leadOption: "standard", idempotencyKey: "has space!" }).success).toBe(false);
    expect(quoteVehicleInput.safeParse({ ...quoteInput, quantity: 0 }).success).toBe(false);
    expect(quoteVehicleInput.safeParse({ ...quoteInput, quantity: 11 }).success).toBe(false);
    expect(quoteVehicleInput.safeParse({ ...quoteInput, quantity: 4 }).success).toBe(true); // feasibility, not schema, enforces 3
    expect(quoteVehicleInput.safeParse({ ...quoteInput, leadOptions: [] }).success).toBe(false);
    expect(listOrdersInput.safeParse({ limit: 51 }).success).toBe(false);
    expect(getOrderUpdatesInput.safeParse({ waitSeconds: 21 }).success).toBe(false);
    expect(getOrderUpdatesInput.safeParse({ limit: 0 }).success).toBe(false);
    expect(orderView.safeParse({ ...exampleOrder, quantity: 4 }).success).toBe(false);
    expect(orderView.safeParse({ ...exampleOrder, virtual: false }).success).toBe(false);
    expect(quoteVehicleOutput.safeParse({}).success).toBe(false);
  });

  it("extends the production order and live frame contracts additively", () => {
    const base = { id: "order-7", quantity: 1, completed: 0, priority: 3, status: "queued", createdAt: 0 };
    expect(productionOrderSchema.safeParse({ ...base, source: "agent", externalRef: "ao-7k2m9q4x1c" }).success).toBe(true);
    expect(productionOrderSchema.safeParse({ ...base, source: "manual" }).success).toBe(true);
    expect(productionOrderSchema.safeParse({ ...base, source: "partner" }).success).toBe(false);
    expect(checkpointSchema).toBeDefined();
    const desk = {
      floorId: "order-floor",
      simTime: 10,
      intakePaused: false,
      orders: [],
      metrics: { active: 0, delivered: 0, cancelled: 0, failed: 0, meanQuotedShipSeconds: null, meanActualShipSeconds: null, onTimeShare: null, source: "simulated" },
      virtual: true,
      disclaimer: VIRTUAL_DISCLAIMER,
    };
    expect(orderDeskViewSchema.safeParse(desk).success).toBe(true);
    expect(ordersMessageSchema.safeParse({ type: "orders", sessionId: "order-floor", sequence: 1, desk }).success).toBe(true);
    expect(ordersMessageSchema.safeParse({ type: "orders", sessionId: "other", sequence: 1, desk }).success).toBe(false);
    expect(ordersMessageSchema.safeParse({ type: "orders", sessionId: "order-floor", sequence: 1, desk: { ...desk, virtual: false } }).success).toBe(false);
  });
});
