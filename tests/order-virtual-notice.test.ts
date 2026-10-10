import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { hasVirtualNotice, ORDER_TOOL_NAMES, VIRTUAL_DISCLAIMER } from "../packages/contracts/src/orders.ts";
import { REST_ROUTES } from "../apps/server/src/order-desk/rest.ts";
import { orderApp, quoteBody } from "./helpers/order-server.ts";

// Safety rule 1 (spec correction 36): every agent-facing body says it is virtual, on success and on
// every error, over REST, SSE and MCP. JSON-RPC envelopes carry it in error.data or result._meta.

const ACCESS = "operator-test-code";
type Injected = { statusCode: number; body: string; headers: Record<string, unknown> };
const json = (response: { body: string }) => JSON.parse(response.body);

/** Top-level notice for REST and tool bodies; error.data or result._meta for JSON-RPC envelopes. */
function noticeIn(body: unknown): boolean {
  if (hasVirtualNotice(body)) return true;
  const record = body as { jsonrpc?: string; error?: { data?: unknown }; result?: { _meta?: unknown } } | null;
  if (record?.jsonrpc === "2.0") return hasVirtualNotice(record.error?.data) || hasVirtualNotice(record.result?._meta);
  return false;
}
function expectNotice(label: string, response: Injected, status?: number) {
  if (status !== undefined) expect(response.statusCode, `${label}: ${response.body.slice(0, 200)}`).toBe(status);
  const body = json(response);
  expect(noticeIn(body), `${label} lacks the virtual notice: ${response.body.slice(0, 300)}`).toBe(true);
  return body;
}

async function connect(url: string, key?: string) {
  const client = new Client({ name: "brickworks-virtual-audit", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: key ? { headers: { Authorization: `Bearer ${key}` } } : undefined }),
  );
  return client;
}
type ToolResult = { structuredContent?: Record<string, unknown>; isError?: boolean; content?: Array<{ type: string; text?: string }>; _meta?: unknown };
const toolBody = (result: ToolResult) => (result.isError ? JSON.parse(result.content?.[0]?.text ?? "{}") : result.structuredContent);

describe("virtual notice on every REST response (safety rule 1)", () => {
  it("walks every route on success and on every error class", async () => {
    const { app, keys, advance } = await orderApp({ rateLimits: { perAgentPerMinute: 100_000, invalidAuthPerMinute: 1000 } }, { accessCode: ACCESS, publicMode: true });
    const inject = (method: "GET" | "POST", url: string, headers: Record<string, string> = {}, payload?: unknown) =>
      app.inject({ method, url, headers, payload: payload as never }) as Promise<Injected>;
    try {
      // Success on every tool route.
      expectNotice("catalog", await inject("GET", "/api/agent/v1/catalog"), 200);
      expectNotice("capabilities", await inject("GET", "/api/agent/v1/capabilities"), 200);
      const quote = expectNotice("quote", await inject("POST", "/api/agent/v1/quotes", keys.a.auth, quoteBody()), 200);
      const placeBody = { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "vn-place-0001" };
      const placed = expectNotice("place", await inject("POST", "/api/agent/v1/orders", keys.a.auth, placeBody), 200);
      expectNotice("place replay", await inject("POST", "/api/agent/v1/orders", keys.a.auth, placeBody), 200);
      const id = placed.order.orderId as string;
      expectNotice("list_orders", await inject("GET", "/api/agent/v1/orders", keys.a.auth), 200);
      expectNotice("get_order", await inject("GET", `/api/agent/v1/orders/${id}`, keys.a.auth), 200);
      expectNotice("get_order_updates", await inject("GET", "/api/agent/v1/updates?limit=5", keys.a.auth), 200);
      expectNotice("get_order_updates long poll (empty)", await inject("GET", "/api/agent/v1/updates?wait=1&cursor=u999999", keys.a.auth), 200);
      const q2 = json(await inject("POST", "/api/agent/v1/quotes", keys.a.auth, quoteBody(1, "zone-metro")));
      const second = json(await inject("POST", "/api/agent/v1/orders", keys.a.auth, { quoteId: q2.quoteId, leadOption: "standard", idempotencyKey: "vn-place-0002" }));
      expectNotice("cancel_order", await inject("POST", `/api/agent/v1/orders/${second.order.orderId}/cancel`, keys.a.auth, { idempotencyKey: "vn-cancel-001" }), 200);

      // Every error class.
      expectNotice("401 no key", await inject("POST", "/api/agent/v1/quotes", {}, quoteBody()), 401);
      expectNotice("401 bad key", await inject("GET", "/api/agent/v1/orders", { authorization: "Bearer bwk_nobody_0000000000000000000000" }), 401);
      expectNotice("403 scope", await inject("POST", "/api/agent/v1/quotes", keys.reader.auth, quoteBody()), 403);
      expectNotice("400 unknown key", await inject("POST", "/api/agent/v1/quotes", keys.a.auth, { ...quoteBody(), payment: { card: "4111" } }), 400);
      expectNotice("400 bad cursor", await inject("GET", "/api/agent/v1/updates?cursor=zzz", keys.a.auth), 400);
      const malformed = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: { ...keys.a.auth, "content-type": "application/json" }, payload: "{not json" });
      expectNotice("400 malformed JSON", malformed as Injected, 400);
      const huge = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: { ...keys.a.auth, "content-type": "application/json" }, payload: JSON.stringify({ pad: "x".repeat(70_000) }) });
      expectNotice("413 body too large", huge as Injected, 413);
      const textBody = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: { ...keys.a.auth, "content-type": "text/plain" }, payload: "hello" });
      // The app registers a text parser, so a text body reaches validation and fails there.
      expectNotice("400 text body", textBody as Injected, 400);
      const xml = await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: { ...keys.a.auth, "content-type": "application/xml" }, payload: "<a/>" });
      expectNotice("415 content type", xml as Injected, 415);
      expectNotice("404 order", await inject("GET", "/api/agent/v1/orders/ao-0000000000", keys.a.auth), 404);
      expectNotice("404 other agent", await inject("GET", `/api/agent/v1/orders/${id}`, keys.b.auth), 404);
      expectNotice("404 cancel", await inject("POST", "/api/agent/v1/orders/ao-0000000000/cancel", keys.a.auth, { idempotencyKey: "vn-cancel-404" }), 404);
      expectNotice("404 updates", await inject("GET", "/api/agent/v1/updates?orderId=ao-0000000000", keys.a.auth), 404);
      expectNotice("404 route", await inject("GET", "/api/agent/v1/nope", keys.a.auth), 404);
      expectNotice("404 SSE", await inject("GET", "/api/agent/v1/orders/ao-0000000000/events", keys.a.auth), 404);
      expectNotice("404 quote", await inject("POST", "/api/agent/v1/orders", keys.a.auth, { quoteId: "aq-0000000000", leadOption: "standard", idempotencyKey: "vn-noquote-01" }), 404);
      expectNotice("409 key reuse", await inject("POST", "/api/agent/v1/orders", keys.a.auth, { ...placeBody, leadOption: "standard" }), 409);
      const big = json(await inject("POST", "/api/agent/v1/quotes", keys.b.auth, quoteBody(4)));
      expectNotice("422 infeasible", await inject("POST", "/api/agent/v1/orders", keys.b.auth, { quoteId: big.quoteId, leadOption: "standard", idempotencyKey: "vn-infeasible" }), 422);
      // Once a unit is committed as a vehicle, cancel is a conflict.
      const committed = async () => json(await inject("GET", `/api/agent/v1/orders/${id}`, keys.a.auth)).order.units[0].vehicleId !== null;
      for (let i = 0; i < 400 && !(await committed()); i++) advance(2);
      expect(await committed()).toBe(true);
      expectNotice("409 cancel not allowed", await inject("POST", `/api/agent/v1/orders/${id}/cancel`, keys.a.auth, { idempotencyKey: "vn-late-cancel" }), 409);

      // SSE events carry the notice in every data payload.
      const address = await app.listen({ port: 0, host: "127.0.0.1" });
      const controller = new AbortController();
      const stream = await fetch(`${address}/api/agent/v1/orders/${id}/events`, { headers: keys.a.auth, signal: controller.signal });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      let text = "";
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))]);
        if (chunk && !chunk.done) text += new TextDecoder().decode(chunk.value);
      }
      controller.abort();
      const events = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
      expect(events.length).toBeGreaterThan(2);
      for (const event of events) expect(hasVirtualNotice(event)).toBe(true);

      // 503 paused, then 503 kill switch on every REST route.
      await inject("POST", "/api/order-floor/intake", {}, { accessCode: ACCESS, paused: true });
      const q3 = json(await inject("POST", "/api/agent/v1/quotes", keys.b.auth, quoteBody()));
      expectNotice("503 paused", await inject("POST", "/api/agent/v1/orders", keys.b.auth, { quoteId: q3.quoteId, leadOption: "standard", idempotencyKey: "vn-paused-01" }), 503);
      await inject("POST", "/api/order-floor/intake", {}, { accessCode: ACCESS, paused: false });
      await inject("POST", "/api/order-floor/kill-switch", {}, { accessCode: ACCESS, thrown: true });
      for (const route of REST_ROUTES) {
        const url = `/api/agent/v1${route.path.replace("{orderId}", id)}`;
        const body = expectNotice(`503 kill switch ${route.method} ${route.path}`, await inject(route.method, url, keys.a.auth, route.method === "POST" ? {} : undefined), 503);
        expect(body.error.code).toBe("ORDER_DESK_DISABLED");
      }
      expectNotice("503 kill switch openapi", await inject("GET", "/api/agent/v1/openapi.json"), 503);
    } finally {
      await app.close();
    }
  }, 90_000);

  it("answers 429 with the notice, and 503 with the notice when the desk is off", async () => {
    const limited = await orderApp({ rateLimits: { anonymousPerMinute: 1 } });
    try {
      await limited.app.inject({ method: "GET", url: "/api/agent/v1/catalog" });
      expectNotice("429 anonymous", (await limited.app.inject({ method: "GET", url: "/api/agent/v1/catalog" })) as Injected, 429);
    } finally {
      await limited.app.close();
    }
    const off = await orderApp({ enabled: false });
    try {
      for (const route of REST_ROUTES) {
        const url = `/api/agent/v1${route.path.replace("{orderId}", "ao-0000000000")}`;
        expectNotice(`503 off ${route.method} ${route.path}`, (await off.app.inject({ method: route.method, url, payload: route.method === "POST" ? {} : undefined })) as Injected, 503);
      }
      expectNotice("503 off /mcp", (await off.app.inject({ method: "POST", url: "/mcp", payload: {} })) as Injected, 503);
    } finally {
      await off.app.close();
    }
  });
});

describe("virtual notice on every MCP response (safety rule 1)", () => {
  it("walks every tool on success and error, resources, and transport errors", async () => {
    const { app, keys, advance } = await orderApp({ rateLimits: { quotePerMinute: 3 } }, { accessCode: ACCESS, publicMode: true });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = await connect(url, keys.a.key);
    const anonymous = await connect(url);
    const reader = await connect(url, keys.reader.key);
    try {
      // tools/list registers the client's output validators, so every success below is also schema checked.
      const listed = await client.listTools();
      expect(hasVirtualNotice(listed._meta)).toBe(true);
      const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as ToolResult;
      const success = async (name: string, args: Record<string, unknown>) => {
        const result = await call(client, name, args);
        expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
        expect(hasVirtualNotice(result.structuredContent), `${name} structuredContent`).toBe(true);
        expect(hasVirtualNotice(JSON.parse(result.content![0].text!)), `${name} text`).toBe(true);
        expect(hasVirtualNotice(result._meta), `${name} _meta`).toBe(true);
        return result.structuredContent as Record<string, any>;
      };
      const failure = async (c: Client, name: string, args: Record<string, unknown>, code: string) => {
        const result = await call(c, name, args);
        expect(result.isError, `${name} should fail with ${code}`).toBe(true);
        const body = toolBody(result);
        expect(body.error.code, name).toBe(code);
        expect(body.virtual).toBe(true);
        expect(body.disclaimer).toBe(VIRTUAL_DISCLAIMER);
        expect(hasVirtualNotice(result._meta)).toBe(true);
      };

      await success("list_vehicle_configs", {});
      await success("get_capabilities", {});
      const quote = await success("quote_vehicle", quoteBody());
      const place = { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "vn-mcp-0001" };
      const placed = await success("place_order", place);
      const id = placed.order.orderId as string;
      await success("get_order", { orderId: id });
      await success("list_orders", {});
      await success("get_order_updates", { limit: 5 });
      const q2 = await success("quote_vehicle", quoteBody(1, "zone-metro"));
      const second = await success("place_order", { quoteId: q2.quoteId, leadOption: "standard", idempotencyKey: "vn-mcp-0002" });
      await success("cancel_order", { orderId: second.order.orderId, idempotencyKey: "vn-mcp-cancel" });

      // Every tool rejects an unknown key with VALIDATION_FAILED (our body, not the SDK's text).
      const valid: Record<string, Record<string, unknown>> = {
        list_vehicle_configs: {},
        get_capabilities: {},
        quote_vehicle: quoteBody(),
        place_order: { quoteId: "aq-0000000000", leadOption: "standard", idempotencyKey: "vn-mcp-bad-1" },
        get_order: { orderId: id },
        list_orders: {},
        cancel_order: { orderId: id, idempotencyKey: "vn-mcp-bad-2" },
        get_order_updates: {},
      };
      for (const name of ORDER_TOOL_NAMES) await failure(client, name, { ...valid[name], payment: { card: "1" } }, "VALIDATION_FAILED");
      await failure(client, "not_a_tool", {}, "VALIDATION_FAILED");
      await failure(anonymous, "quote_vehicle", quoteBody(), "UNAUTHORIZED");
      await failure(anonymous, "list_orders", {}, "UNAUTHORIZED");
      await failure(reader, "place_order", valid.place_order, "FORBIDDEN_SCOPE");
      await failure(client, "get_order", { orderId: "ao-0000000000" }, "ORDER_NOT_FOUND");
      await failure(client, "get_order_updates", { orderId: "ao-0000000000" }, "ORDER_NOT_FOUND");
      await failure(client, "cancel_order", { orderId: "ao-0000000000", idempotencyKey: "vn-mcp-nf-01" }, "ORDER_NOT_FOUND");
      await failure(client, "place_order", valid.place_order, "QUOTE_NOT_FOUND");
      await failure(client, "place_order", { ...place, leadOption: "standard" }, "IDEMPOTENCY_KEY_REUSED");
      await success("quote_vehicle", quoteBody());
      await failure(client, "quote_vehicle", quoteBody(), "RATE_LIMITED");

      // Resources and their errors.
      for (const uri of ["brickworks://catalog", "brickworks://capabilities", `brickworks://orders/${id}`, `brickworks://orders/${id}/updates`]) {
        const read = await client.readResource({ uri });
        expect(hasVirtualNotice(JSON.parse(String((read.contents[0] as { text: string }).text))), uri).toBe(true);
        expect(hasVirtualNotice(read._meta), `${uri} _meta`).toBe(true);
      }
      const missing = await client.readResource({ uri: "brickworks://orders/ao-0000000000" }).catch((error: unknown) => error);
      expect(missing).toBeInstanceOf(McpError);
      expect(hasVirtualNotice((missing as McpError).data)).toBe(true);
      const unknownUri = await client.readResource({ uri: "brickworks://nothing" }).catch((error: unknown) => error);
      expect(hasVirtualNotice((unknownUri as McpError).data)).toBe(true);

      // Paused intake over MCP.
      await app.inject({ method: "POST", url: "/api/order-floor/intake", payload: { accessCode: ACCESS, paused: true } });
      const bClient = await connect(url, keys.b.key);
      const q3 = (await bClient.callTool({ name: "quote_vehicle", arguments: quoteBody() })) as ToolResult;
      await failure(bClient, "place_order", { quoteId: q3.structuredContent!.quoteId, leadOption: "standard", idempotencyKey: "vn-mcp-pause" }, "ORDER_DESK_PAUSED");
      await app.inject({ method: "POST", url: "/api/order-floor/intake", payload: { accessCode: ACCESS, paused: false } });
      await bClient.close();
      advance(1);

      // Transport-level errors written by the desk or by the SDK transport.
      const rpc = (body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${url}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${keys.a.key}`, ...headers },
          body: typeof body === "string" ? body : JSON.stringify(body),
        });
      const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } };
      const expectRaw = async (label: string, response: Response, status: number) => {
        const text = await response.text();
        expect(response.status, `${label}: ${text.slice(0, 200)}`).toBe(status);
        expect(noticeIn(JSON.parse(text)), `${label} lacks the notice: ${text.slice(0, 300)}`).toBe(true);
      };
      await expectRaw("403 origin", await rpc(init, { origin: "https://evil.example" }), 403);
      await expectRaw("404 session", await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "not-a-session" }), 404);
      await expectRaw("400 missing session", await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), 400);
      await expectRaw("406 accept", await rpc(init, { accept: "application/json" }), 406);
      await expectRaw("400 parse", await rpc("{nope"), 400);
      await expectRaw("413 too large", await rpc({ ...init, pad: "x".repeat(70_000) }), 413);
      await expectRaw("401 bad key", await rpc(init, { authorization: "Bearer bwk_nobody_0000000000000000000000" }), 401);
      await expectRaw("400 not JSON-RPC", await rpc({ hello: "world" }), 400);

      // Kill switch: existing sessions and new requests.
      await app.inject({ method: "POST", url: "/api/order-floor/kill-switch", payload: { accessCode: ACCESS, thrown: true } });
      await expectRaw("503 kill switch", await rpc(init), 503);
    } finally {
      await Promise.all([client.close(), anonymous.close(), reader.close()].map((p) => p.catch(() => undefined)));
      await app.close();
    }
  }, 90_000);
});
