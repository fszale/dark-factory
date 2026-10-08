import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  initialOrderState,
  initialUnitState,
  orderTransition,
  unitPublicStatus,
  unitStage,
  unitTransition,
  unitDelayed,
  type OrderEvent,
  type UnitEvent,
  type UnitStateValue,
} from "../packages/orders/src/lifecycle.ts";

const runOrder = (events: OrderEvent[], quantity = 1) =>
  events.reduce((state, event) => orderTransition(state, event).state, initialOrderState(quantity));
const runUnit = (events: UnitEvent["type"][]) =>
  events.reduce<UnitStateValue>((value, type) => unitTransition(value, { type } as UnitEvent).value, initialUnitState());

describe("agent order lifecycle machines (task 4)", () => {
  it("walks the happy path and aggregates by the least advanced unit", () => {
    const order = runOrder([{ type: "DESK_ACCEPTED" }, { type: "FACTORY_ORDER_CREATED" }, { type: "UNIT_COMMITTED" }], 2);
    expect(order.value).toBe("fulfilling");
    expect(order.context.committedUnits).toBe(1);
    const shipped = runUnit(["UNIT_COMMITTED", "UNIT_JOINED", "UNIT_PASSED", "UNIT_STAGING", "UNIT_PARKED", "UNIT_DISPATCH_STARTED", "UNIT_SHIPPED"]);
    expect(unitPublicStatus(shipped)).toBe("shipped");
    expect(aggregateStatus(order, [shipped, initialUnitState()])).toBe("scheduled");
    const delivered = runUnit(["UNIT_COMMITTED", "UNIT_JOINED", "UNIT_PASSED", "UNIT_STAGING", "UNIT_PARKED", "UNIT_DISPATCH_STARTED", "UNIT_SHIPPED", "CARRIER_DEPARTED", "CARRIER_OUT_FOR_DELIVERY", "CARRIER_DELIVERED"]);
    expect(aggregateStatus(order, [shipped, delivered])).toBe("shipped");
    const done = orderTransition(order, { type: "ALL_UNITS_DELIVERED" }).state;
    expect(aggregateStatus(done, [delivered, delivered])).toBe("delivered");
  });

  it("maps unit states to public statuses and stages", () => {
    expect(unitPublicStatus(runUnit(["QUEUE_HEAD"]))).toBe("in_production");
    expect(unitPublicStatus(runUnit(["QUEUE_HEAD", "QUEUE_DEMOTED"]))).toBe("scheduled");
    expect(unitStage(runUnit(["QUEUE_HEAD"]))).toBe("modules");
    expect(unitPublicStatus(runUnit(["UNIT_COMMITTED"]))).toBe("in_production");
    expect(unitPublicStatus(runUnit(["UNIT_COMMITTED", "UNIT_JOINED", "UNIT_REWORK"]))).toBe("quality_check");
    expect(unitStage(runUnit(["UNIT_COMMITTED", "UNIT_JOINED", "UNIT_PASSED"]))).toBeNull();
    const transit = runUnit(["UNIT_COMMITTED", "UNIT_JOINED", "UNIT_PASSED", "UNIT_STAGING", "UNIT_PARKED", "UNIT_DISPATCH_STARTED", "UNIT_SHIPPED", "CARRIER_DEPARTED", "CARRIER_DELAYED"]);
    expect(unitDelayed(transit)).toBe(true);
    expect(unitStage(transit)).toBe("carrier");
    expect(unitPublicStatus(transit)).toBe("in_transit");
    expect(unitDelayed(unitTransition(transit, { type: "CARRIER_RECOVERED" }).value)).toBe(false);
    expect(unitTransition(transit, { type: "CARRIER_LOST" }).value).toBe("failed");
  });

  it("refuses illegal transitions without changing state", () => {
    const placed = initialOrderState(1);
    const skip = orderTransition(placed, { type: "ALL_UNITS_DELIVERED" });
    expect(skip.changed).toBe(false);
    expect(skip.state).toBe(placed);
    expect(unitTransition("queued", { type: "UNIT_SHIPPED" })).toEqual({ value: "queued", changed: false });
    const final = runOrder([{ type: "CANCEL_REQUESTED", by: "agent" }]);
    expect(final.value).toBe("cancelled");
    expect(orderTransition(final, { type: "DESK_ACCEPTED" }).changed).toBe(false);
  });

  it("guards cancellation once a unit is committed and supports reject, confirm and operator cancel", () => {
    const scheduled = runOrder([{ type: "DESK_ACCEPTED" }, { type: "FACTORY_ORDER_CREATED" }]);
    const cancelling = orderTransition(scheduled, { type: "CANCEL_REQUESTED", by: "agent" }).state;
    expect(cancelling.value).toBe("cancelling");
    expect(orderTransition(cancelling, { type: "CANCEL_REJECTED" }).state.value).toBe("scheduled");
    expect(orderTransition(cancelling, { type: "CANCEL_CONFIRMED" }).state).toMatchObject({ value: "cancelled", context: { reason: "agent_requested" } });
    expect(orderTransition(scheduled, { type: "CANCEL_CONFIRMED" }).state).toMatchObject({ value: "cancelled", context: { reason: "operator_cancelled" } });
    const fulfilling = orderTransition(scheduled, { type: "UNIT_COMMITTED" }).state;
    expect(orderTransition(fulfilling, { type: "CANCEL_REQUESTED", by: "agent" }).changed).toBe(false);
    expect(orderTransition(fulfilling, { type: "FAIL", reason: "carrier_lost" }).state).toMatchObject({ value: "failed", context: { reason: "carrier_lost" } });
    const accepted = runOrder([{ type: "DESK_ACCEPTED" }]);
    expect(orderTransition(accepted, { type: "INJECTION_FAILED" }).state).toMatchObject({ value: "failed", context: { reason: "injection_rejected" } });
  });
});
