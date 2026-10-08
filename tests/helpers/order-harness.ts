import { FactorySimulation, type AuditEntry } from "../../packages/simulation/src/index.ts";
import { OrderDesk, type AgentIdentity, type DeskArchiveRecord, type DeskOptions, type FloorPort } from "../../packages/orders/src/desk.ts";
import { runForecast } from "../../packages/orders/src/forecast.ts";

export const STEP = 0.125;

export const agentA: AgentIdentity = { id: "agent-a", label: "Test agent A", scopes: ["quote", "order:write", "order:read"], maxActiveOrders: 3 };
export const agentB: AgentIdentity = { id: "agent-b", label: "Test agent B", scopes: ["quote", "order:write", "order:read"], maxActiveOrders: 3 };

export function newFloorSim(seed = 42) {
  return new FactorySimulation({ seed, scenario: "balanced", continuous: true, orderSize: 2, dispatchDwell: 30 }, "order-floor");
}

/** A deterministic in-process floor: fixed quantum ticks, manual wall clock, synchronous forecaster. */
export function createHarness(options: Partial<DeskOptions> & { seed?: number; start?: boolean } = {}) {
  const sim = newFloorSim(options.seed ?? 42);
  let wall = Date.UTC(2026, 9, 8, 12, 0, 0);
  const entries: AuditEntry[] = [];
  const records: DeskArchiveRecord[] = [];
  const port: FloorPort = {
    snapshot: () => sim.snapshot(),
    exportRun: () => sim.exportRun(),
    command: (command) => sim.command(command),
    stepSeconds: STEP,
    seed: options.seed ?? 42,
  };
  const desk = new OrderDesk({
    floor: port,
    now: () => wall,
    forecaster: async (run, request) => runForecast(run, request),
    deliveryTimeScale: 0.05,
    randomId: (() => {
      let n = 0;
      return (prefix: "ao" | "aq") => `${prefix}-${String(++n).padStart(10, "0")}`;
    })(),
    record: (record) => records.push(record),
    ...options,
  });
  sim.subscribeEvents((entry) => {
    entries.push(entry);
    desk.ingest(entry);
  });
  if (options.start !== false) sim.command({ id: "start", type: "start" });
  const tick = (seconds: number) => {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i++) {
      sim.advance(STEP);
      wall += STEP * 1000;
      desk.advanceClock(sim.snapshot().time);
    }
  };
  const until = (predicate: () => boolean, maxSeconds = 4000) => {
    for (let t = 0; t < maxSeconds && !predicate(); t += 1) tick(1);
    return predicate();
  };
  return {
    sim,
    desk,
    port,
    entries,
    records,
    tick,
    until,
    setWall: (ms: number) => (wall = ms),
    wall: () => wall,
  };
}

export const config = { modelId: "robotaxi-gold-two-seat", options: { finish: "gold", seats: 2 } };
