import type { FactorySnapshot, LineId, ProductionOrder } from "../../contracts/src/index.ts";
import type { AuditEntry } from "../../simulation/src/index.ts";

/**
 * The bridge is a pure reducer from the order floor's ordered AuditEntry
 * stream to order desk signals. It keeps a small model of the engine's order
 * queue (built only from events) so queue-head projection follows the same
 * nextOrder rule as the engine and never depends on snapshot polling cadence.
 */
export interface BridgeOrder {
  id: string;
  quantity: number;
  completed: number;
  committed: number;
  priority: number;
  createdAt: number;
  source: ProductionOrder["source"];
  externalRef?: string;
}
export interface BridgeState {
  orders: Record<string, BridgeOrder>;
  /** factory order id to desk order id, kept until the order's last vehicle leaves. */
  refs: Record<string, string>;
  /** Agent vehicles only: vehicle id to factory order id. */
  vehicles: Record<string, string>;
  queueHead: string | null;
  risks: string[];
}

export type BridgeSignal = { factoryEvent: { id: number; type: string }; time: number } & (
  | { type: "FACTORY_ORDER_CREATED"; ref: string; factoryOrderId: string }
  | { type: "QUEUE_HEAD"; ref: string }
  | { type: "QUEUE_DEMOTED"; ref: string }
  | { type: "UNIT_COMMITTED"; ref: string; vehicleId: string; modules: string[]; lots: string[] }
  | { type: "UNIT_JOINED"; ref: string; vehicleId: string }
  | { type: "UNIT_REWORK"; ref: string; vehicleId: string; defectClass: string | null }
  | { type: "UNIT_PASSED"; ref: string; vehicleId: string }
  | { type: "FACTORY_ORDER_RETIRED"; ref: string; factoryOrderId: string }
  | { type: "UNIT_STAGING"; ref: string; vehicleId: string }
  | { type: "UNIT_PARKED"; ref: string; vehicleId: string }
  | { type: "UNIT_DISPATCH_STARTED"; ref: string; vehicleId: string }
  | { type: "UNIT_SHIPPED"; ref: string; vehicleId: string }
  | { type: "CANCEL_CONFIRMED"; ref: string; factoryOrderId: string }
  | { type: "RISK_RAISED"; reason: string }
  | { type: "RISK_CLEARED"; reason: string }
  | { type: "FLOOR_RESET" }
);
export type LineageSignal = {
  type: "UNIT_LINEAGE";
  ref: string;
  vehicleId: string;
  modules: Array<{ id: string; line: LineId; lot: string; reworkHistory?: unknown[] }>;
};

const SITE_FAULTS = ["supply", "congestion", "assembly", "dispatch"];

export function createBridgeState(snapshot: FactorySnapshot): BridgeState {
  const state: BridgeState = { orders: {}, refs: {}, vehicles: {}, queueHead: null, risks: [] };
  resyncOrders(state, snapshot.orders, snapshot.vehicles);
  for (const key of SITE_FAULTS)
    if (snapshot.faults[key as keyof typeof snapshot.faults]) state.risks.push(`site_fault:${key}`);
  for (const station of Object.values(snapshot.stations)) {
    if (station.status === "faulted" || station.status === "maintenance")
      state.risks.push(`station_fault:${station.id}`);
    if (station.status === "paused") state.risks.push(`station_paused:${station.id}`);
  }
  state.queueHead = computeQueueHead(state);
  return state;
}

function resyncOrders(
  state: BridgeState,
  orders: ProductionOrder[],
  vehicles: Array<{ id: string; orderId?: string; completedAt: number | null }> = [],
) {
  state.orders = {};
  for (const order of orders)
    state.orders[order.id] = {
      id: order.id,
      quantity: order.quantity,
      completed: order.completed,
      committed: vehicles.filter((v) => v.orderId === order.id && v.completedAt === null).length,
      priority: order.priority,
      createdAt: order.createdAt,
      source: order.source,
      ...(order.externalRef ? { externalRef: order.externalRef } : {}),
    };
}

/** Same selection rule as FactorySimulation.nextOrder: priority, then createdAt, then numeric id. */
export function computeQueueHead(state: BridgeState): string | null {
  const open = Object.values(state.orders)
    .filter((o) => o.completed + o.committed < o.quantity)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  return open[0]?.id ?? null;
}

const orderIdOf = (data: Record<string, unknown> | undefined) =>
  typeof data?.orderId === "string" ? data.orderId : undefined;

/**
 * Apply one audit entry. Returns the new state and the signals it produced.
 * The input state is not mutated.
 */
export function bridgeReduce(
  input: BridgeState,
  entry: AuditEntry,
): { state: BridgeState; signals: BridgeSignal[]; lineage: LineageSignal | null } {
  const state: BridgeState = structuredClone(input);
  const signals: BridgeSignal[] = [];
  if (entry.kind === "lineage") {
    const vehicleId = String(entry.lineage.id ?? "");
    const factoryOrderId = String(entry.lineage.orderId ?? "");
    const ref = state.refs[factoryOrderId];
    return {
      state,
      signals,
      lineage: ref
        ? {
            type: "UNIT_LINEAGE",
            ref,
            vehicleId,
            modules: (entry.lineage.modules as LineageSignal["modules"]) ?? [],
          }
        : null,
    };
  }
  if (entry.kind !== "event") return { state, signals, lineage: null };
  const event = entry.event;
  const base = { factoryEvent: { id: event.id, type: event.type }, time: event.time };
  const data = event.data;
  const refFor = (factoryOrderId: string | undefined) =>
    factoryOrderId ? state.refs[factoryOrderId] : undefined;
  const vehicleRef = () => refFor(state.vehicles[event.entity] ?? orderIdOf(data));
  const raise = (reason: string) => {
    if (state.risks.includes(reason)) return;
    state.risks.push(reason);
    signals.push({ ...base, type: "RISK_RAISED", reason });
  };
  const clear = (match: (reason: string) => boolean) => {
    for (const reason of state.risks.filter(match)) {
      state.risks = state.risks.filter((r) => r !== reason);
      signals.push({ ...base, type: "RISK_CLEARED", reason });
    }
  };
  let queueMayChange = false;
  switch (event.type) {
    case "order-created": {
      const order = data?.order as ProductionOrder | undefined;
      if (!order) break;
      state.orders[order.id] = {
        id: order.id,
        quantity: order.quantity,
        completed: order.completed,
        committed: 0,
        priority: order.priority,
        createdAt: order.createdAt,
        source: order.source,
        ...(order.externalRef ? { externalRef: order.externalRef } : {}),
      };
      if (order.source === "agent" && order.externalRef) {
        state.refs[order.id] = order.externalRef;
        signals.push({ ...base, type: "FACTORY_ORDER_CREATED", ref: order.externalRef, factoryOrderId: order.id });
      }
      queueMayChange = true;
      break;
    }
    case "order-priority-changed": {
      const order = state.orders[event.entity];
      if (order && typeof data?.priority === "number") order.priority = data.priority;
      queueMayChange = true;
      break;
    }
    case "order-resized": {
      const order = state.orders[event.entity];
      if (order && typeof data?.quantity === "number") order.quantity = data.quantity;
      queueMayChange = true;
      break;
    }
    case "assembly-start": {
      const factoryOrderId = orderIdOf(data);
      const order = factoryOrderId ? state.orders[factoryOrderId] : undefined;
      if (order) order.committed++;
      const ref = refFor(factoryOrderId);
      if (ref && factoryOrderId) {
        state.vehicles[event.entity] = factoryOrderId;
        signals.push({
          ...base,
          type: "UNIT_COMMITTED",
          ref,
          vehicleId: event.entity,
          modules: ((data?.modules as string[]) ?? []).slice(0, 5),
          lots: ((data?.lots as string[]) ?? []).slice(0, 5),
        });
      }
      queueMayChange = true;
      break;
    }
    case "assembly-joined": {
      const ref = vehicleRef();
      if (ref) signals.push({ ...base, type: "UNIT_JOINED", ref, vehicleId: event.entity });
      break;
    }
    case "vehicle-rework": {
      const ref = vehicleRef();
      if (ref)
        signals.push({
          ...base,
          type: "UNIT_REWORK",
          ref,
          vehicleId: event.entity,
          defectClass: typeof data?.defectClass === "string" ? data.defectClass : null,
        });
      break;
    }
    case "vehicle-complete": {
      const factoryOrderId = orderIdOf(data) ?? state.vehicles[event.entity];
      const order = factoryOrderId ? state.orders[factoryOrderId] : undefined;
      if (order) {
        order.committed = Math.max(0, order.committed - 1);
        order.completed++;
      }
      const ref = refFor(factoryOrderId);
      if (ref) signals.push({ ...base, type: "UNIT_PASSED", ref, vehicleId: event.entity });
      queueMayChange = true;
      break;
    }
    case "order-completed": {
      const order = data?.order as ProductionOrder | undefined;
      const id = order?.id ?? event.entity;
      delete state.orders[id];
      const ref = refFor(id);
      if (ref) signals.push({ ...base, type: "FACTORY_ORDER_RETIRED", ref, factoryOrderId: id });
      queueMayChange = true;
      break;
    }
    case "order-cancelled": {
      const order = data?.order as ProductionOrder | undefined;
      const id = order?.id ?? event.entity;
      delete state.orders[id];
      const ref = refFor(id);
      if (ref) {
        signals.push({ ...base, type: "CANCEL_CONFIRMED", ref, factoryOrderId: id });
        delete state.refs[id];
      }
      queueMayChange = true;
      break;
    }
    case "parking-route":
    case "vehicle-parked":
    case "dispatch-start":
    case "vehicle-dispatched": {
      const factoryOrderId = orderIdOf(data) ?? state.vehicles[event.entity];
      const ref = refFor(factoryOrderId);
      if (!ref) break;
      const type = ({
        "parking-route": "UNIT_STAGING",
        "vehicle-parked": "UNIT_PARKED",
        "dispatch-start": "UNIT_DISPATCH_STARTED",
        "vehicle-dispatched": "UNIT_SHIPPED",
      } as const)[event.type];
      signals.push({ ...base, type, ref, vehicleId: event.entity });
      if (event.type === "vehicle-dispatched") {
        delete state.vehicles[event.entity];
        if (
          factoryOrderId &&
          !state.orders[factoryOrderId] &&
          !Object.values(state.vehicles).includes(factoryOrderId)
        )
          delete state.refs[factoryOrderId];
      }
      break;
    }
    case "site-fault":
      raise(`site_fault:${event.entity}`);
      break;
    case "site-repaired":
      clear((r) => r.startsWith("site_fault:") || r === "supply_hold");
      break;
    case "station-fault":
      raise(`station_fault:${event.entity}`);
      break;
    case "maintenance-start":
      raise(`station_fault:${event.entity}`);
      break;
    case "maintenance-complete":
      clear((r) => r === `station_fault:${event.entity}`);
      break;
    case "station-paused":
      raise(`station_paused:${event.entity}`);
      break;
    case "station-resumed":
      clear((r) => r === `station_paused:${event.entity}`);
      break;
    case "supply-hold":
      raise("supply_hold");
      break;
    case "dock-start":
      clear((r) => r === "supply_hold");
      break;
    case "reset": {
      signals.push({ ...base, type: "FLOOR_RESET" });
      state.vehicles = {};
      state.refs = {};
      state.risks = [];
      resyncOrders(state, (data?.orders as ProductionOrder[]) ?? []);
      queueMayChange = true;
      break;
    }
  }
  if (queueMayChange) {
    const previous = state.queueHead;
    const next = computeQueueHead(state);
    if (previous !== next) {
      state.queueHead = next;
      const previousRef = previous ? state.refs[previous] : undefined;
      const prevOrder = previous ? state.orders[previous] : undefined;
      // Demotion only matters while the previous head still has unassigned units.
      if (previousRef && prevOrder && prevOrder.completed + prevOrder.committed < prevOrder.quantity)
        signals.push({ ...base, type: "QUEUE_DEMOTED", ref: previousRef });
      const nextRef = next ? state.refs[next] : undefined;
      if (nextRef) signals.push({ ...base, type: "QUEUE_HEAD", ref: nextRef });
    }
  }
  return { state, signals, lineage: null };
}
