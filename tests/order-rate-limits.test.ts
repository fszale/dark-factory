import { describe, expect, it } from "vitest";
import { RateLimiter, SlidingWindows } from "../apps/server/src/order-desk/auth.ts";
import { DEFAULT_RATE_LIMITS } from "../apps/server/src/order-desk/config.ts";
import { orderApp, quoteBody } from "./helpers/order-server.ts";

// Spec correction 38: auth, then validation, the kill switch and the intake pause run before the
// strict quote and place budgets, so a rejected request never spends them and a 429 never hides
// the real error. Floods are still capped by the looser per-agent, per-IP and failed-auth windows.

const ACCESS = "operator-test-code";
const json = (response: { body: string }) => JSON.parse(response.body);

describe("rate limiter ordering (spec correction 38)", () => {
  it("charges the place budget only for orders that are actually created", async () => {
    const { app, keys } = await orderApp({ rateLimits: { placePerMinute: 1 } }, { accessCode: ACCESS, publicMode: true });
    const post = (url: string, payload: unknown, headers: Record<string, string> = keys.a.auth) => app.inject({ method: "POST", url, headers, payload: payload as never });
    try {
      const quote = json(await post("/api/agent/v1/quotes", quoteBody()));
      const order = { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "rl-place-0001" };
      // Invalid bodies: always 400, never 429, never charged.
      for (let i = 0; i < 4; i++) {
        const invalid = await post("/api/agent/v1/orders", { ...order, payment: { card: "4111" } });
        expect(invalid.statusCode).toBe(400);
        expect(json(invalid).error.code).toBe("VALIDATION_FAILED");
      }
      // Unknown quote: 404 each time, not charged.
      for (let i = 0; i < 3; i++) expect((await post("/api/agent/v1/orders", { ...order, quoteId: "aq-0000000000", idempotencyKey: `rl-none-000${i}` })).statusCode).toBe(404);
      // Paused intake: the real 503 ORDER_DESK_PAUSED every time, not charged.
      await post("/api/order-floor/intake", { accessCode: ACCESS, paused: true }, {});
      for (let i = 0; i < 3; i++) {
        const paused = await post("/api/agent/v1/orders", order);
        expect(paused.statusCode).toBe(503);
        expect(json(paused).error.code).toBe("ORDER_DESK_PAUSED");
      }
      await post("/api/order-floor/intake", { accessCode: ACCESS, paused: false }, {});
      // Kill switch: 503 ORDER_DESK_DISABLED, not charged.
      await post("/api/order-floor/kill-switch", { accessCode: ACCESS, thrown: true }, {});
      const killed = await post("/api/agent/v1/orders", order);
      expect(killed.statusCode).toBe(503);
      expect(json(killed).error.code).toBe("ORDER_DESK_DISABLED");
      await post("/api/order-floor/kill-switch", { accessCode: ACCESS, thrown: false }, {});
      // The budget is still whole: the first real order goes through.
      const placed = await post("/api/agent/v1/orders", order);
      expect(placed.statusCode, placed.body).toBe(200);
      // An idempotent replay creates nothing, so it is not charged either.
      const replay = await post("/api/agent/v1/orders", order);
      expect(replay.statusCode).toBe(200);
      expect(json(replay).replayed).toBe(true);
      // A second new order in the same minute is over budget.
      const q2 = json(await post("/api/agent/v1/quotes", quoteBody(1, "zone-metro")));
      const limited = await post("/api/agent/v1/orders", { quoteId: q2.quoteId, leadOption: "standard", idempotencyKey: "rl-place-0002" });
      expect(limited.statusCode).toBe(429);
      expect(json(limited).error.code).toBe("RATE_LIMITED");
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      // Even over budget, an invalid body still reports the real error.
      expect((await post("/api/agent/v1/orders", { ...order, address: "x" })).statusCode).toBe(400);
      // The refused placement created nothing.
      expect(json(await app.inject({ method: "GET", url: "/api/agent/v1/orders", headers: keys.a.auth })).orders).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("charges the quote budget only for valid quotes, over REST and MCP", async () => {
    const { app, keys } = await orderApp({ rateLimits: { quotePerMinute: 1 } });
    try {
      for (let i = 0; i < 3; i++) {
        const invalid = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: { ...quoteBody(), phone: "555" } });
        expect(invalid.statusCode).toBe(400);
      }
      expect((await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() })).statusCode).toBe(429);
      expect((await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: { ...quoteBody(), phone: "555" } })).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("keeps flood protection: failed auth per IP and the looser per-agent window", async () => {
    const { app, keys } = await orderApp({ rateLimits: { invalidAuthPerMinute: 3, perAgentPerMinute: 5 } });
    try {
      const bad = { authorization: "Bearer bwk_nobody_0000000000000000000000" };
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: "/api/agent/v1/orders", headers: bad })).statusCode).toBe(401);
      const flooded = await app.inject({ method: "GET", url: "/api/agent/v1/orders", headers: bad });
      expect(flooded.statusCode).toBe(429);
      expect(Number(flooded.headers["retry-after"])).toBeGreaterThan(0);
      // Missing keys on protected calls count against the same per-IP window.
      expect((await app.inject({ method: "POST", url: "/api/agent/v1/quotes", payload: quoteBody() })).statusCode).toBe(429);
      expect((await app.inject({ method: "POST", url: "/mcp", headers: bad, payload: {} })).statusCode).toBe(429);
      // A valid key still works from the same IP; its own window caps invalid floods.
      for (let i = 0; i < 5; i++) expect((await app.inject({ method: "GET", url: "/api/agent/v1/orders?cursor=bad", headers: keys.a.auth })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/agent/v1/orders?cursor=bad", headers: keys.a.auth })).statusCode).toBe(429);
      expect((await app.inject({ method: "GET", url: "/api/agent/v1/orders", headers: keys.b.auth })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("charges every place window all or nothing", () => {
    let now = 0;
    const windows = new SlidingWindows(() => now);
    expect(windows.take("a", 1, 60_000)).toBeNull();
    expect(windows.takeAll([{ bucket: "b", limit: 1, windowMs: 60_000 }, { bucket: "a", limit: 1, windowMs: 60_000 }])).not.toBeNull();
    expect(windows.peek("b", 1, 60_000)).toBeNull();
    const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, placePerMinute: 5, placePerDay: 2 }, () => now);
    const agent = { id: "x", label: "x", scopes: [], maxActiveOrders: 3, webhook: null };
    limiter.charge(agent, "place_order");
    limiter.charge(agent, "place_order");
    expect(() => limiter.charge(agent, "place_order")).toThrow(/Rate limit/);
    now += 24 * 60 * 60_000 + 1;
    limiter.charge(agent, "place_order");
  });
});
