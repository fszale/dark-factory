import { describe, expect, it } from "vitest";
import { listVehicleConfigsOutput, quoteVehicleOutput } from "../packages/contracts/src/orders.ts";
import { listVehicleConfigs, resolvedOptions, findModel } from "../packages/orders/src/catalog.ts";
import { checkFeasibility, hasErrors } from "../packages/orders/src/feasibility.ts";
import { basisHash, runForecast } from "../packages/orders/src/forecast.ts";
import { leadOptionPrice, priceLines, PRICE_BOOK } from "../packages/orders/src/pricing.ts";
import { agentA, config, createHarness, newFloorSim, STEP } from "./helpers/order-harness.ts";

const base = (overrides: Partial<Parameters<typeof checkFeasibility>[0]> = {}) => ({
  config,
  quantity: 1,
  destinationZone: "zone-local",
  snapshot: newFloorSim().snapshot(),
  agentActiveOrders: 0,
  agentMaxActiveOrders: 3,
  floorActiveAgentOrders: 0,
  intakePaused: false,
  ...overrides,
});
const codes = (overrides: Partial<Parameters<typeof checkFeasibility>[0]>) => checkFeasibility(base(overrides)).map((i) => i.code);

describe("catalog, pricing and feasibility (task 6)", () => {
  it("lists one buildable configuration with offered and not-offered values", () => {
    const out = listVehicleConfigsOutput.parse(listVehicleConfigs());
    expect(out.models).toHaveLength(1);
    expect(out.priceBookVersion).toBe(PRICE_BOOK.id);
    expect(JSON.stringify(out)).toContain("not");
    expect(resolvedOptions(findModel("robotaxi-gold-two-seat")!, {})).toEqual({ finish: "gold", seats: 2 });
  });

  it("prices in virtual currency with carrier and expedite lines", () => {
    const lines = priceLines("robotaxi-gold-two-seat", 2, "zone-metro");
    expect(lines.map((l) => l.code)).toEqual(["MODEL:robotaxi-gold-two-seat", "CARRIER:zone-metro", "EXPEDITE_PREMIUM"]);
    expect(leadOptionPrice("robotaxi-gold-two-seat", 2, "zone-metro", "standard")).toEqual({ amount: 2 * 1000 + 2 * 40, currency: "BWC-VIRTUAL" });
    expect(leadOptionPrice("robotaxi-gold-two-seat", 2, "zone-metro", "expedite").amount).toBe(2 * 1000 + 2 * 40 + 2 * PRICE_BOOK.expeditePremiumPerUnit);
  });

  it("reports every feasibility code with the right severity", () => {
    expect(hasErrors(checkFeasibility(base()))).toBe(false);
    expect(codes({ config: { modelId: "hovercar", options: {} } })).toContain("MODEL_UNKNOWN");
    expect(codes({ config: { modelId: config.modelId, options: { finish: "black" } } })).toContain("OPTION_NOT_OFFERED");
    expect(codes({ config: { modelId: config.modelId, options: { wings: "yes" } } })).toContain("OPTION_NOT_OFFERED");
    expect(codes({ quantity: 4 })).toContain("QUANTITY_ABOVE_LIMIT");
    expect(codes({ destinationZone: "zone-moon" })).toContain("ZONE_UNKNOWN");
    expect(codes({ agentActiveOrders: 3 })).toContain("AGENT_ORDER_CAP");
    expect(codes({ floorActiveAgentOrders: 10 })).toContain("FLOOR_ORDER_SLOTS_FULL");
    expect(codes({ intakePaused: true })).toContain("ORDER_DESK_PAUSED");
    const sim = newFloorSim();
    sim.command({ id: "f", type: "fault", value: "assembly" });
    sim.command({ id: "s", type: "fault", station: "front", value: "x" });
    sim.command({ id: "p", type: "pause", station: "rear" });
    const issues = checkFeasibility(base({ snapshot: sim.snapshot() }));
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.code)).toEqual(expect.arrayContaining(["ASSEMBLY_OUTAGE_ACTIVE", "STATION_FAULTED", "STATION_PAUSED"]));
    expect(hasErrors(issues)).toBe(false);
    const full = newFloorSim();
    for (let i = full.snapshot().orders.length; i < 20; i++) full.command({ id: `o${i}`, type: "order-create", value: "1:3" });
    expect(codes({ snapshot: full.snapshot() })).toContain("FLOOR_ORDER_SLOTS_FULL");
  });
});

describe("forecast lead options (task 8)", () => {
  it("is deterministic, leaves the live floor untouched and gives expedite no later than standard", () => {
    const sim = newFloorSim();
    sim.command({ id: "start", type: "start" });
    for (let i = 0; i < 40; i++) sim.advance(STEP);
    for (let i = 0; i < 3; i++) sim.command({ id: `v${i}`, type: "order-create", value: "2:3" });
    const run = sim.exportRun();
    const before = JSON.stringify(sim.snapshot());
    const standard = runForecast(run, { probe: { quantity: 1, priority: 3 }, track: [], stepSeconds: STEP });
    const again = runForecast(run, { probe: { quantity: 1, priority: 3 }, track: [], stepSeconds: STEP });
    const expedite = runForecast(run, { probe: { quantity: 1, priority: 2 }, track: [], stepSeconds: STEP });
    expect(JSON.stringify(sim.snapshot())).toBe(before);
    expect(again).toEqual(standard);
    expect(standard.probe!.reachedHorizon).toBe(false);
    expect(expedite.probe!.shipBySimTime!).toBeLessThanOrEqual(standard.probe!.shipBySimTime!);
    expect(expedite.probe!.shipBySimTime!).toBeLessThan(standard.probe!.shipBySimTime!);
    expect(basisHash(run)).toBe(basisHash(sim.exportRun()));
    expect(basisHash(run)).toMatch(/^[0-9a-f]{24}$/);
  });

  it("reports the horizon when the floor is paused and the quote carries confidence unknown", async () => {
    const h = createHarness({ start: false });
    const quote = quoteVehicleOutput.parse(await h.desk.quote(agentA, { config, quantity: 1, destinationZone: "zone-local", leadOptions: ["standard"] }));
    expect(quote.leadOptions[0]).toMatchObject({ shipBySimTime: null, confidence: "unknown" });
    expect(quote.feasibility.issues.map((i) => i.code)).toContain("FORECAST_HORIZON_EXCEEDED");
  });

  it("flags quotes taken during disruptions as at-risk and reports progress", async () => {
    const h = createHarness();
    h.tick(5);
    h.sim.command({ id: "cong", type: "fault", value: "congestion" });
    const progress: number[] = [];
    const quote = await h.desk.quote(agentA, { config, quantity: 2, destinationZone: "zone-metro", leadOptions: ["standard", "expedite"] }, (p) => progress.push(p));
    expect(quote.leadOptions.every((o) => o.confidence === "at-risk" || o.confidence === "unknown")).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(quote.basis.priceBookVersion).toBe(PRICE_BOOK.id);
  });
});
