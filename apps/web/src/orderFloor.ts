/**
 * DF-ORDER-001 web helpers for the shared order floor view. Pure functions so the
 * live frame validator, stepper mapping and feed text are unit tested without a browser.
 */
import { z } from "zod";
import {
  ordersMessageSchema,
  snapshotMessageSchema,
} from "../../../packages/contracts/src/runtime.ts";
import type {
  DeskOrderCard,
  OrderDeskView,
  OrderStatus,
  UnitView,
} from "../../../packages/contracts/src/orders.ts";

export const FLOOR_SESSION_ID = "order-floor";
export const FLOOR_BANNER =
  "Shared order floor, read-only. Agent orders run here.";

/** Every frame the client accepts on /api/live. Anything else is rejected. */
export const liveFrameSchema = z.discriminatedUnion("type", [
  snapshotMessageSchema,
  ordersMessageSchema,
]);
export type LiveFrame = z.infer<typeof liveFrameSchema>;

/** Parse one raw websocket payload; throws on malformed JSON or schema mismatch. */
export function parseLiveFrame(raw: string): LiveFrame {
  return liveFrameSchema.parse(JSON.parse(raw));
}

export const STEPPER = [
  "placed",
  "scheduled",
  "modules",
  "joining",
  "quality",
  "parked",
  "shipped",
  "in transit",
  "delivered",
] as const;

const STATUS_STEP: Record<OrderStatus, number> = {
  placed: 0,
  accepted: 0,
  scheduled: 1,
  in_production: 2,
  quality_check: 4,
  completed: 5,
  ready_for_pickup: 5,
  shipped: 6,
  in_transit: 7,
  out_for_delivery: 7,
  delivered: 8,
  cancelled: -1,
  failed: -1,
};

const STAGE_STEP: Partial<Record<NonNullable<UnitView["stage"]>, number>> = {
  queued: 1,
  modules: 2,
  joining: 3,
};

/** Stepper index for an order (least advanced unit), or -1 for cancelled and failed. */
export function stepIndex(card: Pick<DeskOrderCard, "status" | "units">): number {
  const base = STATUS_STEP[card.status];
  if (card.status !== "in_production") return base;
  const stages = card.units
    .filter((unit) => unit.status === "in_production")
    .map((unit) => (unit.stage ? (STAGE_STEP[unit.stage] ?? base) : base));
  return stages.length ? Math.min(...stages) : base;
}

export const statusLabel = (status: OrderStatus) => status.replace(/_/g, " ");

/** Short noun for the feed line, for example "robotaxi". */
export function vehicleNoun(modelId: string, quantity: number): string {
  const noun = modelId.includes("robotaxi") ? "robotaxi" : modelId;
  return quantity === 1 ? noun : `${noun}s`;
}

export function newOrderMessage(card: DeskOrderCard): string {
  return `New agent order ${card.orderId} from ${card.agentLabel}: ${card.quantity} ${vehicleNoun(card.modelId, card.quantity)}, ${card.leadOption}, ${card.destinationZone}.`;
}

/** Orders present in `next` that were not in `previous`, oldest first. */
export function arrivals(
  previous: OrderDeskView | null,
  next: OrderDeskView,
): DeskOrderCard[] {
  if (!previous) return [];
  const known = new Set(previous.orders.map((order) => order.orderId));
  return next.orders
    .filter((order) => !known.has(order.orderId))
    .sort((a, b) => a.placedAtSimTime - b.placedAtSimTime);
}

/** The agent order (and unit) that owns a vehicle on the floor, if any. */
export function agentOrderForVehicle(
  desk: OrderDeskView | null,
  vehicleId: string,
): { card: DeskOrderCard; unit: UnitView } | null {
  if (!desk || !vehicleId) return null;
  for (const card of desk.orders)
    for (const unit of card.units)
      if (unit.vehicleId === vehicleId) return { card, unit };
  return null;
}

export const simClock = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return "pending";
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};
