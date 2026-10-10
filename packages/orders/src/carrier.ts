import {
  CARRIER_NAME,
  DESTINATION_ZONES,
  type DelayReason,
  type DestinationZone,
  type TrackingView,
} from "../../contracts/src/orders.ts";

/**
 * Brickworks Virtual Freight: a deterministic, seeded virtual carrier advanced
 * on the order floor's simulation clock. Its random draws use their own
 * namespace (floor seed plus order id), so delivery randomness never perturbs
 * manufacturing streams or replay.
 */
export const MAX_CARRIER_DELAY_FACTOR = 1.6;
export const MIN_CARRIER_DELAY_FACTOR = 1.2;
export const CARRIER_DELAY_PROBABILITY = 0.08;
/** Seeded delays never use the operator-hold reason; that one is reserved for explicit holds. */
const DELAY_REASONS: DelayReason[] = [
  "virtual-weather",
  "virtual-road-closure",
  "virtual-hub-backlog",
];

export const ZONE_ROUTES: Record<
  DestinationZone,
  { nominalSeconds: number; stops: string[]; shares: number[] }
> = {
  "zone-local": {
    nominalSeconds: 120,
    stops: ["Customer exit", "Local Depot", "Destination (zone-local)"],
    shares: [0.5, 0.5],
  },
  "zone-metro": {
    nominalSeconds: 300,
    stops: ["Customer exit", "Brickworks Hub", "Metro Depot", "Destination (zone-metro)"],
    shares: [0.3, 0.4, 0.3],
  },
  "zone-regional": {
    nominalSeconds: 600,
    stops: [
      "Customer exit",
      "Brickworks Hub",
      "Regional Sort",
      "Regional Depot",
      "Destination (zone-regional)",
    ],
    shares: [0.2, 0.3, 0.3, 0.2],
  },
  "zone-remote": {
    nominalSeconds: 900,
    stops: [
      "Customer exit",
      "Brickworks Hub",
      "Regional Sort",
      "Remote Crossdock",
      "Remote Depot",
      "Destination (zone-remote)",
    ],
    shares: [0.15, 0.25, 0.25, 0.2, 0.15],
  },
};

export function nominalTransitSeconds(zone: DestinationZone, scale = 1) {
  return ZONE_ROUTES[zone].nominalSeconds * scale;
}

export const zoneList = () =>
  DESTINATION_ZONES.map((id) => ({ id, nominalTransitSeconds: ZONE_ROUTES[id].nominalSeconds }));

/** Same LCG construction as FactorySimulation.rng, but in a separate "carrier:" namespace. */
export function carrierDraws(seed: number, key: string, count: number): number[] {
  let state = seed >>> 0;
  for (const c of key) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  const draws: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    draws.push(state / 4294967296);
  }
  return draws;
}

export type CarrierEventKind =
  | "departed_hub"
  | "arrived_hub"
  | "delayed"
  | "recovered"
  | "out_for_delivery"
  | "delivered";
export interface CarrierEvent {
  time: number;
  kind: CarrierEventKind;
  leg: number;
  emitted: boolean;
  reason?: DelayReason;
}
export interface CarrierLeg {
  from: string;
  to: string;
  plannedStart: number;
  plannedEnd: number;
  actualEnd: number | null;
  delayed: boolean;
  delayReason: DelayReason | null;
  delayFactor: number;
}
export interface CarrierPlan {
  trackingId: string;
  orderId: string;
  unitIndex: number;
  zone: DestinationZone;
  shippedAt: number;
  legs: CarrierLeg[];
  events: CarrierEvent[];
  heldSince: number | null;
  lost: boolean;
}

/** Build the whole route at hand-off; every later event is a pure function of this plan. */
export function createCarrierPlan(options: {
  seed: number;
  orderId: string;
  unitIndex: number;
  zone: DestinationZone;
  shippedAt: number;
  timeScale?: number;
}): CarrierPlan {
  const route = ZONE_ROUTES[options.zone];
  const scale = options.timeScale ?? 1;
  const legs: CarrierLeg[] = [];
  const events: CarrierEvent[] = [];
  let start = options.shippedAt;
  route.shares.forEach((share, leg) => {
    const nominal = route.nominalSeconds * share * scale;
    const [delayDraw, factorDraw, reasonDraw] = carrierDraws(
      options.seed,
      `carrier:${options.orderId}:${options.unitIndex}:${leg}`,
      3,
    );
    const delayed = delayDraw < CARRIER_DELAY_PROBABILITY;
    const factor = delayed
      ? MIN_CARRIER_DELAY_FACTOR + (MAX_CARRIER_DELAY_FACTOR - MIN_CARRIER_DELAY_FACTOR) * factorDraw
      : 1;
    const reason = delayed ? DELAY_REASONS[Math.floor(reasonDraw * DELAY_REASONS.length) % DELAY_REASONS.length] : null;
    const plannedEnd = start + nominal;
    const end = start + nominal * factor;
    const last = leg === route.shares.length - 1;
    legs.push({
      from: route.stops[leg],
      to: route.stops[leg + 1],
      plannedStart: start,
      plannedEnd,
      actualEnd: null,
      delayed,
      delayReason: reason,
      delayFactor: factor,
    });
    events.push({ time: start, kind: last ? "out_for_delivery" : "departed_hub", leg, emitted: false });
    if (delayed) {
      events.push({ time: plannedEnd, kind: "delayed", leg, emitted: false, reason: reason! });
      events.push({ time: end, kind: "recovered", leg, emitted: false, reason: reason! });
    }
    events.push({ time: end, kind: last ? "delivered" : "arrived_hub", leg, emitted: false });
    start = end;
  });
  return {
    trackingId: `bvf-${options.orderId}-${options.unitIndex}`,
    orderId: options.orderId,
    unitIndex: options.unitIndex,
    zone: options.zone,
    shippedAt: options.shippedAt,
    legs,
    events,
    heldSince: null,
    lost: false,
  };
}

/** Mark and return every not-yet-emitted event due at or before `time`. Held or lost plans emit nothing. */
export function dueCarrierEvents(plan: CarrierPlan, time: number): CarrierEvent[] {
  if (plan.heldSince !== null || plan.lost) return [];
  const due: CarrierEvent[] = [];
  for (const event of plan.events) {
    if (event.emitted) continue;
    if (event.time > time + 1e-9) break;
    event.emitted = true;
    if (event.kind === "arrived_hub" || event.kind === "delivered")
      plan.legs[event.leg].actualEnd = event.time;
    due.push(event);
  }
  return due;
}

export function nextCarrierEventTime(plan: CarrierPlan): number | null {
  if (plan.heldSince !== null || plan.lost) return null;
  return plan.events.find((event) => !event.emitted)?.time ?? null;
}

export function currentLeg(plan: CarrierPlan): number {
  const next = plan.events.find((event) => !event.emitted);
  return next ? next.leg : plan.legs.length - 1;
}

/** Operator hold for QA of the delayed path. Simulated time keeps running; the unit does not move. */
export function holdCarrier(plan: CarrierPlan, time: number): boolean {
  if (plan.heldSince !== null || plan.lost || plan.events.every((e) => e.emitted)) return false;
  plan.heldSince = time;
  const leg = plan.legs[currentLeg(plan)];
  if (!leg.delayed) {
    leg.delayed = true;
    leg.delayReason = "virtual-operator-hold";
  }
  return true;
}

/** Release shifts every pending event by the hold duration, so ETA moves later and never earlier. */
export function releaseCarrier(plan: CarrierPlan, time: number): number | null {
  if (plan.heldSince === null) return null;
  const duration = Math.max(0, time - plan.heldSince);
  for (const event of plan.events) if (!event.emitted) event.time += duration;
  const pendingLegs = new Set(plan.events.filter((e) => !e.emitted).map((e) => e.leg));
  for (const leg of pendingLegs) {
    const current = plan.legs[leg];
    const startPending = plan.events.some(
      (e) => e.leg === leg && !e.emitted && (e.kind === "departed_hub" || e.kind === "out_for_delivery"),
    );
    if (startPending) current.plannedStart += duration;
    current.plannedEnd += duration;
  }
  plan.heldSince = null;
  return duration;
}

export function etaSimTime(plan: CarrierPlan): number | null {
  if (plan.lost) return null;
  const delivered = plan.events.find((event) => event.kind === "delivered");
  return delivered ? delivered.time : null;
}

export function trackingView(
  plan: CarrierPlan,
  toWall: (simTime: number) => string | null,
): TrackingView {
  const eta = etaSimTime(plan);
  return {
    carrier: CARRIER_NAME,
    trackingId: plan.trackingId,
    zone: plan.zone,
    legs: plan.legs.map((leg) => ({
      from: leg.from,
      to: leg.to,
      plannedStart: leg.plannedStart,
      plannedEnd: leg.plannedEnd,
      actualEnd: leg.actualEnd,
      delayed: leg.delayed,
      delayReason: leg.delayReason,
    })),
    etaSimTime: eta,
    etaAt: eta === null ? null : toWall(eta),
    source: "simulated",
  };
}

/** Mark and return only the next pending event if it is due; lets the desk interleave plans in time order. */
export function popNextCarrierEvent(plan: CarrierPlan, time: number): CarrierEvent | null {
  if (plan.heldSince !== null || plan.lost) return null;
  const event = plan.events.find((candidate) => !candidate.emitted);
  if (!event || event.time > time + 1e-9) return null;
  event.emitted = true;
  if (event.kind === "arrived_hub" || event.kind === "delivered")
    plan.legs[event.leg].actualEnd = event.time;
  return event;
}
