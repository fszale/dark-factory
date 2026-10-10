import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/server/src/app.ts";
import { getOrderDeskRuntime } from "../apps/server/src/order-desk/index.ts";
import { ordersMessageSchema, snapshotMessageSchema } from "../packages/contracts/src/runtime.ts";
import { getCapabilitiesOutput, listVehicleConfigsOutput, ORDER_TOOL_NAMES, orderDeskError, placeOrderOutput, quoteVehicleOutput } from "../packages/contracts/src/orders.ts";
import { validateProviderDecision } from "../packages/providers/src/index.ts";
import { orderApp, quoteBody } from "./helpers/order-server.ts";

const json = (response: { body: string }) => JSON.parse(response.body);

describe("order desk server: off by default (task 9, R23)", () => {
  it("answers 503 on every desk path and creates no floor when the flag is unset", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "brickworks-orders-off-"));
    const previous = process.env.ORDER_DESK_ENABLED;
    delete process.env.ORDER_DESK_ENABLED;
    const app = await buildApp({ tickMs: 10_000, orderDesk: { dataDir } });
    try {
      for (const [method, url] of [
        ["POST", "/mcp"],
        ["GET", "/api/agent/v1/catalog"],
        ["POST", "/api/agent/v1/quotes"],
        ["GET", "/llms.txt"],
        ["GET", "/mcp/server-card"],
        ["GET", "/.well-known/mcp.json"],
        ["GET", "/.well-known/mcp/catalog.json"],
        ["GET", "/api/agent/v1/openapi.json"],
        ["POST", "/api/order-floor/command"],
      ] as const) {
        const response = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
        expect(response.statusCode, url).toBe(503);
        expect(orderDeskError.parse(json(response)).error.code, url).toBe("ORDER_DESK_DISABLED");
      }
      expect(json(await app.inject({ method: "GET", url: "/api/order-floor/status" }))).toMatchObject({ enabled: false, active: false });
      expect(getOrderDeskRuntime(app)!.hasFloor).toBe(false);
      expect(readdirSync(dataDir)).toHaveLength(0);
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(json(health).application.activeSessions).toBe(0);
    } finally {
      await app.close();
      if (previous !== undefined) process.env.ORDER_DESK_ENABLED = previous;
    }
  });
});

describe("order desk server: REST mirror, auth and limits (tasks 10 and 11)", () => {
  it("serves anonymous reads, requires keys and scopes, and runs quote, order, track over REST", async () => {
    const { app, keys, advance } = await orderApp();
    try {
      const catalog = await app.inject({ method: "GET", url: "/api/agent/v1/catalog" });
      expect(catalog.statusCode).toBe(200);
      expect(listVehicleConfigsOutput.parse(json(catalog)).virtual).toBe(true);
      const caps = getCapabilitiesOutput.parse(json(await app.inject({ method: "GET", url: "/api/agent/v1/capabilities" })));
      expect(JSON.stringify(caps)).not.toMatch(/seed|wear/i);
      const anonQuote = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", payload: quoteBody() });
      expect(anonQuote.statusCode).toBe(401);
      expect(anonQuote.headers["www-authenticate"]).toContain("Bearer");
      const badKey = await app.inject({ method: "GET", url: "/api/agent/v1/catalog", headers: { authorization: "Bearer bwk_nobody_0000000000000000000000" } });
      expect(badKey.statusCode).toBe(401);
      const noScope = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.reader.auth, payload: quoteBody() });
      expect(noScope.statusCode).toBe(403);
      expect(json(noScope).error.code).toBe("FORBIDDEN_SCOPE");
      const smuggled = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: { ...quoteBody(), payment: { card: "4111" } } });
      expect(smuggled.statusCode).toBe(400);
      expect(json(smuggled).error.code).toBe("VALIDATION_FAILED");
      const quoted = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() });
      expect(quoted.statusCode).toBe(200);
      const quote = quoteVehicleOutput.parse(json(quoted));
      const order = { quoteId: quote.quoteId, leadOption: "expedite" };
      const placed = await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: { ...keys.a.auth, "idempotency-key": "rest-key-0001" }, payload: order });
      expect(placed.statusCode).toBe(200);
      const placedBody = placeOrderOutput.parse(json(placed));
      const replay = await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: { ...keys.a.auth, "idempotency-key": "rest-key-0001" }, payload: order });
      expect(json(replay)).toMatchObject({ replayed: true, order: { orderId: placedBody.order.orderId } });
      const conflict = await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: { ...keys.a.auth, "idempotency-key": "rest-key-0001" }, payload: { ...order, leadOption: "standard" } });
      expect(conflict.statusCode).toBe(409);
      const id = placedBody.order.orderId;
      expect((await app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: keys.b.auth })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/agent/v1/orders/${id}/cancel`, headers: { ...keys.b.auth, "idempotency-key": "steal-key-01" } })).statusCode).toBe(404);
      expect(json(await app.inject({ method: "GET", url: "/api/agent/v1/orders", headers: keys.b.auth })).orders).toHaveLength(0);
      for (let i = 0; i < 400 && json(await app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: keys.a.auth })).order.status !== "delivered"; i++) advance(10);
      const final = json(await app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: keys.a.auth })).order;
      expect(final.status).toBe("delivered");
      const listed = json(await app.inject({ method: "GET", url: "/api/agent/v1/orders?status=delivered&limit=5", headers: keys.a.auth }));
      expect(listed.orders.map((o: { orderId: string }) => o.orderId)).toEqual([id]);
      const updates = json(await app.inject({ method: "GET", url: `/api/agent/v1/updates?orderId=${id}&limit=100`, headers: keys.a.auth }));
      const seqs = updates.updates.map((u: { seq: number }) => u.seq);
      expect(seqs).toEqual([...seqs].sort((x: number, y: number) => x - y));
      expect(updates.updates.at(-1).type).toBe("order.delivered");
      const unknown = await app.inject({ method: "GET", url: "/api/agent/v1/nope", headers: keys.a.auth });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.headers["content-type"]).toContain("application/json");
    } finally {
      await app.close();
    }
  }, 60_000);

  it("rate limits with 429 and Retry-After, and caps concurrent long polls", async () => {
    const { app, keys } = await orderApp({ rateLimits: { quotePerMinute: 2, anonymousPerMinute: 3, concurrentStreams: 1 } });
    try {
      for (let i = 0; i < 2; i++) expect((await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() })).statusCode).toBe(200);
      const limited = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() });
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: "/api/agent/v1/catalog" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/agent/v1/catalog" })).statusCode).toBe(429);
      const first = app.inject({ method: "GET", url: "/api/agent/v1/updates?wait=1", headers: keys.b.auth });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await app.inject({ method: "GET", url: "/api/agent/v1/updates?wait=1", headers: keys.b.auth });
      expect(second.statusCode).toBe(429);
      const started = Date.now();
      const done = await first;
      expect(done.statusCode).toBe(200);
      expect(json(done).updates).toHaveLength(0);
      expect(Date.now() - started).toBeGreaterThan(500);
    } finally {
      await app.close();
    }
  });

  it("returns a long poll early when an update lands", async () => {
    const { app, keys, advance } = await orderApp();
    try {
      const quote = json(await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() }));
      await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: keys.a.auth, payload: { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "poll-key-001" } });
      const page = json(await app.inject({ method: "GET", url: "/api/agent/v1/updates?limit=100", headers: keys.a.auth }));
      const started = Date.now();
      const waiting = app.inject({ method: "GET", url: `/api/agent/v1/updates?wait=15&cursor=${page.nextCursor}`, headers: keys.a.auth });
      setTimeout(() => {
        for (let i = 0; i < 200; i++) advance(1);
      }, 100);
      const result = json(await waiting);
      expect(result.updates.length).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await app.close();
    }
  });

  it("streams SSE and resumes from Last-Event-ID without duplicates", async () => {
    const { app, keys, advance } = await orderApp();
    try {
      const quote = json(await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() }));
      const placed = json(await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: keys.a.auth, payload: { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "sse-key-0001" } }));
      const id = placed.order.orderId;
      advance(60);
      const address = await app.listen({ port: 0, host: "127.0.0.1" });
      const read = async (lastEventId?: string) => {
        const controller = new AbortController();
        const response = await fetch(`${address}/api/agent/v1/orders/${id}/events`, {
          headers: { ...keys.a.auth, ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
          signal: controller.signal,
        });
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        const reader = response.body!.getReader();
        let text = "";
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))]);
          if (chunk && !chunk.done) text += new TextDecoder().decode(chunk.value);
        }
        controller.abort();
        return [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
      };
      const all = await read();
      expect(all.length).toBeGreaterThan(3);
      const resumed = await read(String(all[1]));
      expect(resumed).toEqual(all.slice(2));
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("order desk server: floor authority, kill switch and pause (tasks 3 and 9)", () => {
  it("blocks reset with active agent orders, rejects mode, pauses intake and throws the kill switch", async () => {
    const { app, keys, runtime } = await orderApp({}, { accessCode: "operator-test-code", publicMode: true });
    try {
      const quote = json(await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() }));
      await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: keys.a.auth, payload: { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "auth-key-001" } });
      const noCode = await app.inject({ method: "POST", url: "/api/order-floor/command", payload: { command: { id: "r0", type: "reset" } } });
      expect(noCode.statusCode).toBe(403);
      // The web Orders tab learns operator rights from the status route (no secret is echoed).
      const statusNoCode = json(await app.inject({ method: "GET", url: "/api/order-floor/status" }));
      const statusWrong = json(await app.inject({ method: "GET", url: "/api/order-floor/status", headers: { "x-access-code": "wrong-code" } }));
      const statusOk = json(await app.inject({ method: "GET", url: "/api/order-floor/status", headers: { "x-access-code": "operator-test-code" } }));
      expect([statusNoCode.operator, statusWrong.operator, statusOk.operator]).toEqual([false, false, true]);
      expect(JSON.stringify(statusOk)).not.toContain("operator-test-code");
      const op = (command: Record<string, unknown>) =>
        app.inject({ method: "POST", url: "/api/order-floor/command", payload: { accessCode: "operator-test-code", command } });
      const reset = await op({ id: "r1", type: "reset" });
      expect(reset.statusCode).toBe(409);
      expect(json(reset).message).toContain("agent orders are active");
      expect((await op({ id: "m1", type: "mode", value: "autonomous" })).statusCode).toBe(409);
      expect((await op({ id: "ac", type: "order-agent-create", value: "1:2:ao-0000000099" })).statusCode).toBe(409);
      expect((await op({ id: "f1", type: "fault", value: "supply" })).statusCode).toBe(200);
      expect(runtime.floor().sim.snapshot().mode).toBe("manual");
      const pause = await app.inject({ method: "POST", url: "/api/order-floor/intake", payload: { accessCode: "operator-test-code", paused: true } });
      expect(json(pause).intakePaused).toBe(true);
      const q2 = json(await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.b.auth, payload: quoteBody() }));
      const paused = await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: keys.b.auth, payload: { quoteId: q2.quoteId, leadOption: "standard", idempotencyKey: "pause-key-01" } });
      expect(paused.statusCode).toBe(503);
      expect(json(paused).error.code).toBe("ORDER_DESK_PAUSED");
      expect((await app.inject({ method: "GET", url: "/api/agent/v1/orders", headers: keys.a.auth })).statusCode).toBe(200);
      const kill = await app.inject({ method: "POST", url: "/api/order-floor/kill-switch", payload: { accessCode: "operator-test-code", thrown: true } });
      expect(json(kill)).toMatchObject({ killSwitch: true, active: false });
      for (const url of ["/api/agent/v1/catalog", "/llms.txt"]) expect((await app.inject({ method: "GET", url })).statusCode).toBe(503);
      expect((await app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(503);
      const time = runtime.floorForOperator()!.sim.snapshot().time;
      const release = await app.inject({ method: "POST", url: "/api/order-floor/kill-switch", payload: { accessCode: "operator-test-code", thrown: false } });
      expect(json(release).active).toBe(true);
      expect(runtime.floor().sim.snapshot().time).toBe(time);
      expect((await app.inject({ method: "GET", url: "/api/agent/v1/catalog" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("keeps both new command types out of provider decisions and the visitor route", () => {
    for (const type of ["order-agent-create", "order-cancel"])
      expect(validateProviderDecision({ summary: "test", commands: [{ id: "c1", type, value: "order-1" }], tokens: 0 })).toBe(false);
    expect(validateProviderDecision({ summary: "test", commands: [{ id: "c1", type: "start" }], tokens: 0 })).toBe(true);
  });
});

describe("order desk server: discovery, OpenAPI and transport guards (tasks 12 and 15)", () => {
  it("serves discovery documents from one registry with the public base URL and no secrets", async () => {
    const { app, keys } = await orderApp({ publicBaseUrl: "https://brickworks.example.test" });
    try {
      const llms = await app.inject({ method: "GET", url: "/llms.txt" });
      expect(llms.statusCode).toBe(200);
      expect(llms.headers["access-control-allow-origin"]).toBe("*");
      const card = json(await app.inject({ method: "GET", url: "/mcp/server-card" }));
      const alias = json(await app.inject({ method: "GET", url: "/.well-known/mcp.json" }));
      const catalog = json(await app.inject({ method: "GET", url: "/.well-known/mcp/catalog.json" }));
      expect(alias).toEqual(card);
      expect(card.remotes).toEqual([{ type: "streamable-http", url: "https://brickworks.example.test/mcp" }]);
      expect(card.description.length).toBeLessThanOrEqual(100);
      expect(catalog.servers[0].card).toBe("https://brickworks.example.test/mcp/server-card");
      const cardTools = card._meta["io.github.fszale/brickworks"].tools.map((t: { name: string }) => t.name);
      expect(cardTools).toEqual([...ORDER_TOOL_NAMES]);
      for (const name of ORDER_TOOL_NAMES) expect(llms.body).toContain(`\`${name}\``);
      const all = llms.body + JSON.stringify(card) + JSON.stringify(catalog);
      expect(all).not.toContain("localhost");
      for (const secret of [keys.a.key, keys.a.config.sha256]) expect(all).not.toContain(secret);
      const openapi = json(await app.inject({ method: "GET", url: "/api/agent/v1/openapi.json" }));
      expect(openapi.openapi).toBe("3.1.0");
      expect(openapi.servers[0].url).toBe("https://brickworks.example.test");
      expect(Object.keys(openapi.paths)).toEqual(expect.arrayContaining(["/api/agent/v1/quotes", "/api/agent/v1/orders/{orderId}/cancel"]));
      expect(openapi.paths["/api/agent/v1/quotes"].post.requestBody.content["application/json"].schema.additionalProperties).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("rejects foreign Origin and Host on /mcp and never serves the SPA for desk paths", async () => {
    const { app } = await orderApp();
    try {
      const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
      const foreign = await app.inject({ method: "POST", url: "/mcp", headers: { origin: "https://evil.example", accept: "application/json, text/event-stream" }, payload: init });
      expect(foreign.statusCode).toBe(403);
      const host = await app.inject({ method: "POST", url: "/mcp", headers: { host: "evil.example", accept: "application/json, text/event-stream" }, payload: init });
      expect(host.statusCode).toBe(403);
      const stale = await app.inject({ method: "POST", url: "/mcp", headers: { "mcp-session-id": "00000000-0000-4000-8000-000000000000" }, payload: init });
      expect(stale.statusCode).toBe(404);
      const noInit = await app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
      expect(noInit.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("order desk server: live floor stream (task 16)", () => {
  it("sends validated snapshot and orders frames to floor viewers when the public view is on", async () => {
    const { app } = await orderApp({ publicView: true });
    try {
      await app.ready();
      const socket = await app.injectWS("/api/live");
      const frames: unknown[] = [];
      const got = new Promise<void>((resolve) =>
        socket.on("message", (data) => {
          frames.push(JSON.parse(data.toString()));
          if (frames.length >= 2) resolve();
        }),
      );
      socket.send(JSON.stringify({ view: "order-floor" }));
      await got;
      const snapshot = snapshotMessageSchema.parse(frames.find((f) => (f as { type: string }).type === "snapshot"));
      expect(snapshot.sessionId).toBe("order-floor");
      const orders = ordersMessageSchema.parse(frames.find((f) => (f as { type: string }).type === "orders"));
      expect(orders.desk.virtual).toBe(true);
      socket.close();
    } finally {
      await app.close();
    }
  });

  it("refuses the floor view when it is not public and no operator code is given", async () => {
    const { app } = await orderApp({ publicView: false }, { accessCode: "operator-test-code", publicMode: true });
    try {
      await app.ready();
      const socket = await app.injectWS("/api/live");
      const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
      socket.send(JSON.stringify({ view: "order-floor" }));
      expect(await closed).toBe(1008);
    } finally {
      await app.close();
    }
  });
});

describe("order desk server: persistence and recovery (task 13, R19)", () => {
  it("restores an in-flight order after restart and continues to delivery", async () => {
    const first = await orderApp();
    const quote = json(await first.app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: first.keys.a.auth, payload: quoteBody() }));
    const placed = json(await first.app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: first.keys.a.auth, payload: { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "restart-k01" } }));
    const id = placed.order.orderId;
    first.advance(40);
    const before = json(await first.app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: first.keys.a.auth })).order;
    await first.app.close();
    const file = JSON.parse(readFileSync(join(first.dataDir, "order-floor.json"), "utf8"));
    expect(file.formatVersion).toBe(1);
    const second = await orderApp({ dataDir: first.dataDir, agentKeys: [first.keys.a.config] });
    try {
      expect(second.runtime.floor().restoredFrom).toBe("file");
      const auth = first.keys.a.auth;
      const after = json(await second.app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: auth })).order;
      expect(after.status).toBe(before.status);
      expect(after.lastUpdateSeq).toBe(before.lastUpdateSeq);
      for (let i = 0; i < 400 && json(await second.app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: auth })).order.status !== "delivered"; i++) second.advance(10);
      expect(json(await second.app.inject({ method: "GET", url: `/api/agent/v1/orders/${id}`, headers: auth })).order.status).toBe("delivered");
    } finally {
      await second.app.close();
    }
  }, 60_000);

  it("sets a corrupt floor file aside, logs a warning and starts fresh", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "brickworks-orders-corrupt-"));
    writeFileSync(join(dataDir, "order-floor.json"), "{not json");
    const { app, runtime } = await orderApp({ dataDir });
    try {
      expect(runtime.floor().restoredFrom).toBe("corrupt-file");
      expect(readdirSync(dataDir).some((name) => name.startsWith("order-floor.json.corrupt-"))).toBe(true);
      expect(runtime.floor().desk.deskView().orders).toHaveLength(0);
      expect(existsSync(join(dataDir, "order-floor.json"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("exports and re-imports the floor through operator routes", async () => {
    const { app, keys, advance } = await orderApp({}, { accessCode: "operator-test-code", publicMode: true });
    try {
      const quote = json(await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: keys.a.auth, payload: quoteBody() }));
      const placed = json(await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: keys.a.auth, payload: { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "export-k01" } }));
      advance(20);
      expect((await app.inject({ method: "GET", url: "/api/order-floor/export" })).statusCode).toBe(403);
      const exported = await app.inject({ method: "GET", url: "/api/order-floor/export", headers: { "x-access-code": "operator-test-code" } });
      expect(exported.statusCode).toBe(200);
      advance(60);
      const bad = await app.inject({ method: "POST", url: "/api/order-floor/import", payload: { accessCode: "operator-test-code", state: { formatVersion: 1, desk: {}, floorCheckpoint: {} } } });
      expect(bad.statusCode).toBe(400);
      const ok = await app.inject({ method: "POST", url: "/api/order-floor/import", payload: { accessCode: "operator-test-code", state: json(exported) } });
      expect(ok.statusCode).toBe(200);
      expect(json(await app.inject({ method: "GET", url: `/api/agent/v1/orders/${placed.order.orderId}`, headers: keys.a.auth })).order.orderId).toBe(placed.order.orderId);
    } finally {
      await app.close();
    }
  });
  it("keeps /api/health at 200 and visitor session capacity at 10 with the desk enabled (the floor is not a session)", async () => {
    const { app, runtime } = await orderApp();
    try {
      expect(runtime.active()).toBe(true);
      expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
      for (let index = 0; index < 10; index++) {
        const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { seed: index + 1 } });
        expect(created.statusCode, `session ${index + 1}`).toBe(200);
      }
      const overflow = await app.inject({ method: "POST", url: "/api/sessions", payload: { seed: 99 } });
      expect(overflow.statusCode).toBe(503);
      expect((await app.inject({ method: "GET", url: "/api/order-floor/status" })).json()).toMatchObject({ active: true });
    } finally {
      await app.close();
    }
  });
});
