import { createHash } from "node:crypto";
import type { RunExport } from "../../contracts/src/index.ts";
import { FactorySimulation } from "../../simulation/src/index.ts";

/**
 * Lead-time forecasting by forking the order floor. Because the simulation is
 * deterministic with resource-specific random streams, a fork advanced with
 * the floor's own tick quantum is exactly what the floor will do if nothing
 * new happens (no new orders, no operator faults or repairs).
 */
export const FORECAST_HORIZON_SECONDS = 3600;
export const FORECAST_PLACEHOLDER_REF = "forecast-probe";

export interface ForecastRequest {
  /** Inject a hypothetical agent order before running (quotes). Omit to re-forecast existing orders only. */
  probe?: { quantity: number; priority: number };
  /** Existing factory order ids to track (re-forecast of active agent orders). */
  track: string[];
  /** Floor tick quantum in simulated seconds at speed 1. The fork must use the same quantum to be exact. */
  stepSeconds: number;
  horizonSeconds?: number;
}
export interface OrderForecast {
  completeBySimTime: number | null;
  shipBySimTime: number | null;
  /** Ship time per unit index, in commit order. */
  unitShipTimes: number[];
  reachedHorizon: boolean;
}
export interface ForecastResult {
  basisSimTime: number;
  probe: OrderForecast | null;
  tracked: Record<string, OrderForecast>;
  advancedSeconds: number;
}

/** Opaque, stable hash of the forked checkpoint; the seed itself is never exposed. */
export function basisHash(run: RunExport): string {
  return createHash("sha256").update(JSON.stringify(run)).digest("hex").slice(0, 24);
}

export function runForecast(run: RunExport, request: ForecastRequest): ForecastResult {
  const sim = FactorySimulation.fromExport(run);
  const start = sim.snapshot();
  const horizon = request.horizonSeconds ?? FORECAST_HORIZON_SECONDS;
  const targets = new Map<string, { needComplete: number; needShip: number; completed: number[]; shipped: number[] }>();
  const remainingFor = (factoryOrderId: string) => {
    const order = start.orders.find((o) => o.id === factoryOrderId);
    const committed = start.vehicles.filter((v) => v.orderId === factoryOrderId);
    return { order, committed };
  };
  for (const id of request.track) {
    const { order, committed } = remainingFor(id);
    // Units still on the floor: uncompleted order units plus finished vehicles not yet dispatched.
    const needComplete = order ? order.quantity - order.completed : 0;
    const needShip = needComplete + committed.filter((v) => v.completedAt !== null).length;
    targets.set(id, { needComplete, needShip, completed: [], shipped: [] });
  }
  let probeId: string | null = null;
  sim.subscribeEvents((entry) => {
    if (entry.kind !== "event") return;
    const orderId = entry.event.data?.orderId;
    if (typeof orderId !== "string") return;
    const target = targets.get(orderId);
    if (!target) return;
    if (entry.event.type === "vehicle-complete") target.completed.push(entry.event.time);
    if (entry.event.type === "vehicle-dispatched") target.shipped.push(entry.event.time);
  });
  if (request.probe) {
    const result = sim.command({
      id: "forecast-probe",
      type: "order-agent-create",
      value: `${request.probe.quantity}:${request.probe.priority}:${FORECAST_PLACEHOLDER_REF}`,
    });
    if (result.ok) {
      probeId = result.message.replace(/^Created /, "");
      targets.set(probeId, { needComplete: request.probe.quantity, needShip: request.probe.quantity, completed: [], shipped: [] });
    }
  }
  // The floor clock is always running; a paused floor produces no progress and hits the horizon.
  if (run.snapshot.running) sim.command({ id: "forecast-start", type: "start" });
  const speed = start.speed;
  const done = () => [...targets.values()].every((t) => t.shipped.length >= t.needShip);
  let advanced = 0;
  while (!done() && advanced < horizon - 1e-9 && run.snapshot.running) {
    sim.advance(request.stepSeconds);
    advanced += request.stepSeconds * speed;
  }
  const summarize = (id: string): OrderForecast => {
    const target = targets.get(id)!;
    const finished = target.shipped.length >= target.needShip;
    return {
      completeBySimTime:
        target.needComplete > 0 && target.completed.length >= target.needComplete
          ? Math.max(...target.completed)
          : null,
      shipBySimTime: finished && target.shipped.length ? Math.max(...target.shipped) : null,
      unitShipTimes: [...target.shipped],
      reachedHorizon: !finished,
    };
  };
  const tracked: Record<string, OrderForecast> = {};
  for (const id of request.track) tracked[id] = summarize(id);
  return {
    basisSimTime: start.time,
    probe: probeId ? summarize(probeId) : request.probe ? { completeBySimTime: null, shipBySimTime: null, unitShipTimes: [], reachedHorizon: true } : null,
    tracked,
    advancedSeconds: advanced,
  };
}
