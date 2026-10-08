import { describe, expect, it } from "vitest";
import {
  CARRIER_DELAY_PROBABILITY,
  createCarrierPlan,
  etaSimTime,
  holdCarrier,
  MAX_CARRIER_DELAY_FACTOR,
  nominalTransitSeconds,
  popNextCarrierEvent,
  releaseCarrier,
  trackingView,
  ZONE_ROUTES,
} from "../packages/orders/src/carrier.ts";
import { DESTINATION_ZONES, trackingView as trackingSchema } from "../packages/contracts/src/orders.ts";

const plan = (orderId = "ao-0000000001", zone: (typeof DESTINATION_ZONES)[number] = "zone-regional", seed = 42) =>
  createCarrierPlan({ seed, orderId, unitIndex: 0, zone, shippedAt: 1000 });

const drain = (p: ReturnType<typeof plan>, time = Number.POSITIVE_INFINITY) => {
  const out = [];
  for (let e = popNextCarrierEvent(p, time); e; e = popNextCarrierEvent(p, time)) out.push(e);
  return out;
};

describe("virtual carrier delivery simulation (task 7)", () => {
  it("builds one leg per route hop with a deterministic, time-ordered event list", () => {
    for (const zone of DESTINATION_ZONES) {
      const p = plan("ao-0000000001", zone);
      expect(p.legs).toHaveLength(ZONE_ROUTES[zone].shares.length);
      expect(p.events.map((e) => e.time)).toEqual([...p.events.map((e) => e.time)].sort((a, b) => a - b));
      expect(p.events[0]).toMatchObject({ time: 1000, emitted: false });
      expect(p.events.at(-1)!.kind).toBe("delivered");
      const eta = etaSimTime(p)!;
      expect(eta - 1000).toBeGreaterThanOrEqual(nominalTransitSeconds(zone) - 1e-9);
      expect(eta - 1000).toBeLessThanOrEqual(nominalTransitSeconds(zone) * MAX_CARRIER_DELAY_FACTOR + 1e-9);
      expect(trackingSchema.parse(trackingView(p, () => null)).trackingId).toBe("bvf-ao-0000000001-0");
    }
    expect(plan()).toEqual(plan());
    expect(plan("ao-0000000002")).not.toEqual(plan());
  });

  it("delays roughly the configured share of legs with seeded reasons and recovers each delay", () => {
    let legs = 0;
    let delayed = 0;
    for (let i = 0; i < 400; i++) {
      const p = plan(`ao-${String(i).padStart(10, "0")}`, "zone-remote");
      for (const leg of p.legs) {
        legs++;
        if (!leg.delayed) continue;
        delayed++;
        expect(leg.delayReason).toMatch(/^virtual-(weather|road-closure|hub-backlog)$/);
        expect(leg.delayFactor).toBeGreaterThanOrEqual(1.2);
        expect(leg.delayFactor).toBeLessThanOrEqual(1.6);
      }
      const kinds = drain(p).map((e) => e.kind);
      expect(kinds.filter((k) => k === "delayed")).toHaveLength(kinds.filter((k) => k === "recovered").length);
      expect(kinds.at(-1)).toBe("delivered");
    }
    expect(delayed / legs).toBeGreaterThan(CARRIER_DELAY_PROBABILITY / 2);
    expect(delayed / legs).toBeLessThan(CARRIER_DELAY_PROBABILITY * 2);
  });

  it("emits only due events, and hold/release shifts the remaining schedule later", () => {
    const p = plan("ao-0000000009", "zone-metro");
    const first = drain(p, 1000);
    expect(first.map((e) => e.kind)).toEqual(["departed_hub"]);
    const eta = etaSimTime(p)!;
    expect(holdCarrier(p, 1010)).toBe(true);
    expect(holdCarrier(p, 1011)).toBe(false);
    expect(drain(p, 99_999)).toHaveLength(0);
    expect(p.legs[0].delayReason === "virtual-operator-hold" || p.legs[0].delayed).toBe(true);
    expect(releaseCarrier(p, 1070)).toBe(60);
    expect(releaseCarrier(p, 1080)).toBeNull();
    expect(etaSimTime(p)).toBeCloseTo(eta + 60, 9);
    const rest = drain(p);
    expect(rest.at(-1)!.kind).toBe("delivered");
    expect(p.legs.every((leg) => leg.actualEnd !== null)).toBe(true);
    expect(holdCarrier(p, 99_999)).toBe(false);
  });

  it("scales transit time for QA without changing the event sequence", () => {
    const normal = plan("ao-0000000004", "zone-remote");
    const quick = createCarrierPlan({ seed: 42, orderId: "ao-0000000004", unitIndex: 0, zone: "zone-remote", shippedAt: 1000, timeScale: 0.1 });
    expect(quick.events.map((e) => e.kind)).toEqual(normal.events.map((e) => e.kind));
    expect(etaSimTime(quick)! - 1000).toBeCloseTo((etaSimTime(normal)! - 1000) * 0.1, 6);
  });
});
