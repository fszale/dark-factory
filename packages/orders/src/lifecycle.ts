import { assign, initialTransition, setup, transition } from "xstate";
import {
  ORDER_STATUSES,
  type FailReason,
  type OrderStatus,
  type UnitStage,
} from "../../contracts/src/orders.ts";

/**
 * DF-ORDER-001 order lifecycle. Both machines are used only through XState's
 * pure initialTransition/transition functions; the desk stores serializable
 * { value, context } snapshots and never depends on live actors, so
 * persistence and replay are plain data.
 */
export interface OrderContext {
  quantity: number;
  committedUnits: number;
  reason: string | null;
}
export type OrderEvent =
  | { type: "DESK_ACCEPTED" }
  | { type: "DESK_REJECTED"; reason: string }
  | { type: "FACTORY_ORDER_CREATED" }
  | { type: "INJECTION_FAILED" }
  | { type: "UNIT_COMMITTED" }
  | { type: "ALL_UNITS_DELIVERED" }
  | { type: "CANCEL_REQUESTED"; by: "agent" | "operator" }
  | { type: "CANCEL_REJECTED" }
  | { type: "CANCEL_CONFIRMED" }
  | { type: "FAIL"; reason: FailReason };

export const agentOrderMachine = setup({
  types: {
    context: {} as OrderContext,
    events: {} as OrderEvent,
    input: {} as { quantity: number },
  },
  guards: {
    noUnitCommitted: ({ context }) => context.committedUnits === 0,
  },
  actions: {
    countCommit: assign({
      committedUnits: ({ context }) => context.committedUnits + 1,
    }),
    failReason: assign({
      reason: ({ event }) =>
        event.type === "FAIL"
          ? event.reason
          : event.type === "INJECTION_FAILED"
            ? "injection_rejected"
            : event.type === "DESK_REJECTED"
              ? event.reason
              : null,
    }),
    agentCancel: assign({
      reason: ({ event }) =>
        event.type === "CANCEL_REQUESTED" && event.by === "operator"
          ? "operator_cancelled"
          : "agent_requested",
    }),
    operatorCancel: assign({ reason: () => "operator_cancelled" }),
    clearReason: assign({ reason: () => null }),
  },
}).createMachine({
  id: "agentOrder",
  initial: "placed",
  context: ({ input }) => ({
    quantity: input.quantity,
    committedUnits: 0,
    reason: null,
  }),
  states: {
    placed: {
      on: {
        DESK_ACCEPTED: "accepted",
        DESK_REJECTED: { target: "failed", actions: "failReason" },
        CANCEL_REQUESTED: { target: "cancelled", actions: "agentCancel" },
      },
    },
    accepted: {
      on: {
        FACTORY_ORDER_CREATED: "scheduled",
        INJECTION_FAILED: { target: "failed", actions: "failReason" },
        CANCEL_REQUESTED: { target: "cancelled", actions: "agentCancel" },
      },
    },
    scheduled: {
      on: {
        CANCEL_REQUESTED: {
          guard: "noUnitCommitted",
          target: "cancelling",
          actions: "agentCancel",
        },
        // An operator order-cancel on the floor arrives as a confirmed engine event.
        CANCEL_CONFIRMED: { target: "cancelled", actions: "operatorCancel" },
        UNIT_COMMITTED: { target: "fulfilling", actions: "countCommit" },
        FAIL: { target: "failed", actions: "failReason" },
      },
    },
    // The engine is the referee: a commit that races the cancel wins.
    cancelling: {
      on: {
        CANCEL_CONFIRMED: "cancelled",
        CANCEL_REJECTED: { target: "scheduled", actions: "clearReason" },
        UNIT_COMMITTED: {
          target: "fulfilling",
          actions: ["countCommit", "clearReason"],
        },
        FAIL: { target: "failed", actions: "failReason" },
      },
    },
    fulfilling: {
      on: {
        UNIT_COMMITTED: { actions: "countCommit" },
        ALL_UNITS_DELIVERED: "delivered",
        FAIL: { target: "failed", actions: "failReason" },
      },
    },
    delivered: { type: "final" },
    cancelled: { type: "final" },
    failed: { type: "final" },
  },
});

export type UnitEvent =
  | { type: "QUEUE_HEAD" }
  | { type: "QUEUE_DEMOTED" }
  | { type: "UNIT_COMMITTED" }
  | { type: "UNIT_JOINED" }
  | { type: "UNIT_REWORK" }
  | { type: "UNIT_PASSED" }
  | { type: "UNIT_STAGING" }
  | { type: "UNIT_PARKED" }
  | { type: "UNIT_DISPATCH_STARTED" }
  | { type: "UNIT_SHIPPED" }
  | { type: "CARRIER_DEPARTED" }
  | { type: "CARRIER_DELAYED" }
  | { type: "CARRIER_RECOVERED" }
  | { type: "CARRIER_OUT_FOR_DELIVERY" }
  | { type: "CARRIER_DELIVERED" }
  | { type: "CARRIER_LOST" };

export const agentOrderUnitMachine = setup({
  types: { events: {} as UnitEvent },
}).createMachine({
  id: "agentOrderUnit",
  initial: "queued",
  states: {
    queued: { on: { QUEUE_HEAD: "modules", UNIT_COMMITTED: "joining" } },
    modules: { on: { QUEUE_DEMOTED: "queued", UNIT_COMMITTED: "joining" } },
    joining: { on: { UNIT_JOINED: "end_of_line_test" } },
    end_of_line_test: { on: { UNIT_REWORK: "rework", UNIT_PASSED: "passed" } },
    rework: { on: { UNIT_PASSED: "passed" } },
    passed: { on: { UNIT_STAGING: "staging" } },
    staging: { on: { UNIT_PARKED: "parked" } },
    parked: { on: { UNIT_DISPATCH_STARTED: "dispatching" } },
    dispatching: { on: { UNIT_SHIPPED: "shipped" } },
    shipped: { on: { CARRIER_DEPARTED: "in_transit", CARRIER_OUT_FOR_DELIVERY: "out_for_delivery", CARRIER_LOST: "failed" } },
    in_transit: {
      initial: "moving",
      states: {
        moving: { on: { CARRIER_DELAYED: "delayed" } },
        delayed: { on: { CARRIER_RECOVERED: "moving" } },
      },
      on: {
        CARRIER_OUT_FOR_DELIVERY: "out_for_delivery",
        CARRIER_LOST: "failed",
      },
    },
    out_for_delivery: {
      on: { CARRIER_DELIVERED: "delivered", CARRIER_LOST: "failed" },
    },
    delivered: { type: "final" },
    failed: { type: "final" },
  },
});

export type OrderStateValue =
  | "placed"
  | "accepted"
  | "scheduled"
  | "cancelling"
  | "fulfilling"
  | "delivered"
  | "cancelled"
  | "failed";
export interface OrderMachineState {
  value: OrderStateValue;
  context: OrderContext;
}
export type UnitStateValue =
  | "queued"
  | "modules"
  | "joining"
  | "end_of_line_test"
  | "rework"
  | "passed"
  | "staging"
  | "parked"
  | "dispatching"
  | "shipped"
  | { in_transit: "moving" | "delayed" }
  | "out_for_delivery"
  | "delivered"
  | "failed";

export function initialOrderState(quantity: number): OrderMachineState {
  const [snapshot] = initialTransition(agentOrderMachine, { quantity });
  return {
    value: snapshot.value as OrderStateValue,
    context: structuredClone(snapshot.context),
  };
}

/** Pure step: illegal events leave the state unchanged and report changed=false. */
export function orderTransition(
  state: OrderMachineState,
  event: OrderEvent,
): { state: OrderMachineState; changed: boolean } {
  const current = agentOrderMachine.resolveState({
    value: state.value,
    context: state.context,
  });
  if (!current.can(event)) return { state, changed: false };
  const [next] = transition(agentOrderMachine, current, event);
  return {
    state: {
      value: next.value as OrderStateValue,
      context: structuredClone(next.context),
    },
    changed: true,
  };
}

export function initialUnitState(): UnitStateValue {
  const [snapshot] = initialTransition(agentOrderUnitMachine);
  return snapshot.value as UnitStateValue;
}

export function unitTransition(
  value: UnitStateValue,
  event: UnitEvent,
): { value: UnitStateValue; changed: boolean } {
  const current = agentOrderUnitMachine.resolveState({ value, context: undefined as never });
  if (!current.can(event)) return { value, changed: false };
  const [next] = transition(agentOrderUnitMachine, current, event);
  return { value: next.value as UnitStateValue, changed: true };
}

export const isOrderFinal = (state: OrderMachineState) =>
  ["delivered", "cancelled", "failed"].includes(state.value);

export function unitKey(value: UnitStateValue) {
  return typeof value === "string" ? value : "in_transit";
}

export function unitPublicStatus(value: UnitStateValue): OrderStatus {
  switch (unitKey(value)) {
    case "queued":
      return "scheduled";
    case "modules":
    case "joining":
      return "in_production";
    case "end_of_line_test":
    case "rework":
      return "quality_check";
    case "passed":
    case "staging":
      return "completed";
    case "parked":
    case "dispatching":
      return "ready_for_pickup";
    case "shipped":
      return "shipped";
    case "in_transit":
      return "in_transit";
    case "out_for_delivery":
      return "out_for_delivery";
    case "delivered":
      return "delivered";
    default:
      return "failed";
  }
}

export function unitStage(value: UnitStateValue): UnitStage | null {
  switch (unitKey(value)) {
    case "queued":
    case "modules":
    case "joining":
    case "end_of_line_test":
    case "rework":
    case "staging":
    case "parked":
    case "dispatching":
    case "delivered":
      return unitKey(value) as UnitStage;
    case "shipped":
    case "in_transit":
    case "out_for_delivery":
      return "carrier";
    default:
      return null;
  }
}

export const unitDelayed = (value: UnitStateValue) =>
  typeof value !== "string" && value.in_transit === "delayed";

const rank = (status: OrderStatus) => ORDER_STATUSES.indexOf(status);

/**
 * Order status is the order machine state until production starts, then the
 * least advanced unit's status, so an order reads delivered only when every
 * unit is delivered. Terminal cancelled and failed apply to the whole order.
 */
export function aggregateStatus(
  order: OrderMachineState,
  units: UnitStateValue[],
): OrderStatus {
  switch (order.value) {
    case "placed":
    case "accepted":
    case "delivered":
    case "cancelled":
    case "failed":
      return order.value;
    default: {
      const statuses = units.map(unitPublicStatus);
      if (!statuses.length) return "scheduled";
      return statuses.reduce((least, status) =>
        rank(status) < rank(least) ? status : least,
      );
    }
  }
}
