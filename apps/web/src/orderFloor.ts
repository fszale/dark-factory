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

// ---------------------------------------------------------------- incoming-order toast lifecycle
/**
 * The toast must be seen, not just mounted. A wall-clock timer started at mount can expire before
 * a slow (software GL) client paints the toast even once, so the countdown runs on painted frames:
 * it starts at the first animation frame after mount, credits at most TOAST_MAX_FRAME_CREDIT_MS per
 * frame (a starved main thread does not burn the countdown), credits nothing while held (tab hidden,
 * pointer over it, keyboard focus inside), and never expires before TOAST_MIN_FRAMES painted frames.
 * TOAST_MAX_FOREGROUND_MS bounds how long a very slow client keeps it up.
 */
export const TOAST_VISIBLE_MS = 6000;
export const TOAST_MIN_FRAMES = 3;
export const TOAST_MAX_FRAME_CREDIT_MS = 250;
export const TOAST_MAX_FOREGROUND_MS = 30_000;
const TOAST_MAX_FOREGROUND_CREDIT_MS = 5000;

export interface ToastClock {
  firstPaintAt: number | null;
  lastFrameAt: number | null;
  frames: number;
  visibleMs: number;
  foregroundMs: number;
}

export const newToastClock = (): ToastClock => ({
  firstPaintAt: null,
  lastFrameAt: null,
  frames: 0,
  visibleMs: 0,
  foregroundMs: 0,
});

/** Records one animation frame at `now` (a rAF timestamp). `held` frames earn no credit. */
export function toastFrame(clock: ToastClock, now: number, held = false): ToastClock {
  if (clock.firstPaintAt === null)
    return { firstPaintAt: now, lastFrameAt: now, frames: 1, visibleMs: 0, foregroundMs: 0 };
  const gap = Math.max(0, now - (clock.lastFrameAt ?? now));
  return {
    ...clock,
    lastFrameAt: now,
    frames: clock.frames + 1,
    visibleMs: clock.visibleMs + (held ? 0 : Math.min(gap, TOAST_MAX_FRAME_CREDIT_MS)),
    foregroundMs: clock.foregroundMs + (held ? 0 : Math.min(gap, TOAST_MAX_FOREGROUND_CREDIT_MS)),
  };
}

export function toastExpired(clock: ToastClock): boolean {
  if (clock.firstPaintAt === null || clock.frames < TOAST_MIN_FRAMES) return false;
  return clock.visibleMs >= TOAST_VISIBLE_MS || clock.foregroundMs >= TOAST_MAX_FOREGROUND_MS;
}

// ---------------------------------------------------------------- live frame batching
/**
 * Queues raw websocket payloads and hands them over in one batch per macrotask, so a burst that
 * piled up behind a slow 3D frame costs one React render instead of one per frame.
 */
export function createFrameBatcher<T>(
  apply: (batch: T[]) => void,
  schedule: (flush: () => void) => void = (flush) => void setTimeout(flush, 0),
) {
  let queue: T[] = [];
  let scheduled = false;
  return {
    push(item: T) {
      queue.push(item);
      if (scheduled) return;
      scheduled = true;
      schedule(() => {
        scheduled = false;
        const batch = queue;
        queue = [];
        if (batch.length) apply(batch);
      });
    },
    clear() {
      queue = [];
    },
  };
}

export type SnapshotFrame = Extract<LiveFrame, { type: "snapshot" }>;
export type OrdersFrame = Extract<LiveFrame, { type: "orders" }>;
export interface LiveBatchResult {
  snapshot: SnapshotFrame | null;
  orders: OrdersFrame | null;
  rejected: number;
  accepted: number;
  lastSequence: number;
}

/**
 * Validates every frame in a batch (so each malformed frame is still counted and never applied)
 * and keeps only the newest snapshot and the newest orders frame for the session, in sequence order.
 */
export function reduceLiveBatch(raws: string[], sessionId: string, lastSequence: number): LiveBatchResult {
  const result: LiveBatchResult = { snapshot: null, orders: null, rejected: 0, accepted: 0, lastSequence };
  for (const raw of raws) {
    let frame: LiveFrame;
    try {
      frame = parseLiveFrame(raw);
    } catch {
      result.rejected++;
      continue;
    }
    if (frame.sessionId !== sessionId || frame.sequence <= result.lastSequence) continue;
    result.lastSequence = frame.sequence;
    result.accepted++;
    if (frame.type === "snapshot") result.snapshot = frame;
    else result.orders = frame;
  }
  return result;
}
