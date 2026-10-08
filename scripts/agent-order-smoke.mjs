#!/usr/bin/env node
/**
 * DF-ORDER-001 bundled-server smoke check (local only, never against a deployment).
 *
 * Requires `npm run build`. Starts `node dist/server/index.js` twice on 127.0.0.1:
 *   1. with ORDER_DESK_ENABLED unset: the desk must be off (503 everywhere, no floor);
 *   2. with ORDER_DESK_ENABLED=true and a throwaway agent key generated in memory
 *      (only its sha256 reaches the child env; nothing is written or printed):
 *      MCP tools/list, catalog, capabilities, quote, place (plus idempotent replay),
 *      track with get_order, follow get_order_updates until delivered, a resource
 *      subscription, REST parity, then the kill switch must block MCP and REST calls
 *      and releasing it must restore them.
 *
 * Options: --speed <1|2|5|10> floor speed (default 1, the acceptance setting; the
 * forecast exactness check only applies at speed 1), --timeout-minutes <n> (default 20),
 * --zone <zone> (default zone-local).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const speed = Number(arg("speed", "1"));
const timeoutMs = Number(arg("timeout-minutes", "20")) * 60_000;
const zone = arg("zone", "zone-local");
const root = resolve(import.meta.dirname, "..");
const entry = join(root, "dist/server/index.js");
if (!existsSync(entry)) throw new Error("Run `npm run build` first (dist/server/index.js missing).");

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
const started = Date.now();
const log = (message) => console.log(`[smoke +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);

async function freePort() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.unref();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}

/** Clean child env: drop any inherited order desk or provider settings. */
function childEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(ORDER_|BRICKWORKS_|PUBLIC_BASE_URL|ACCESS_CODE|PUBLIC_MODE|TYPESAFE_|OPENAI_|XAI_)/.test(key)) delete env[key];
  return { ...env, NODE_ENV: "production", ...extra };
}

async function startServer(extra) {
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, [entry], { cwd: root, env: childEnv({ PORT: String(port), ...extra }), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${output.join("").slice(-2000)}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { base, child, output };
    } catch {
      /* not listening yet */
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  child.kill("SIGTERM");
  throw new Error("server did not become healthy");
}
async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const exited = new Promise((ok) => server.child.once("exit", ok));
  server.child.kill("SIGTERM");
  await Promise.race([exited, new Promise((ok) => setTimeout(ok, 5000))]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}
const json = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

// ---------- phase 1: off by default ----------
log("phase 1: bundled server with ORDER_DESK_ENABLED unset");
const off = await startServer({});
try {
  const status = await json(await fetch(`${off.base}/api/order-floor/status`));
  const mcp = await fetch(`${off.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  const rest = await fetch(`${off.base}/api/agent/v1/catalog`);
  const card = await fetch(`${off.base}/mcp/server-card`);
  const floorView = await fetch(`${off.base}/api/order-floor/view`);
  const health = await fetch(`${off.base}/api/health`);
  const session = await fetch(`${off.base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("off: /api/order-floor/status says disabled", () => assert.deepEqual([status.enabled, status.active], [false, false]));
  check("off: POST /mcp returns 503", () => assert.equal(mcp.status, 503));
  check("off: REST /api/agent/v1/catalog returns 503", () => assert.equal(rest.status, 503));
  check("off: discovery /mcp/server-card returns 503", () => assert.equal(card.status, 503));
  check("off: /api/order-floor/view returns 503 (no floor)", () => assert.equal(floorView.status, 503));
  check("off: /api/health still 200", () => assert.equal(health.status, 200));
  check("off: visitor session creation unaffected", () => assert.equal(session.status, 200));
} finally {
  await stopServer(off);
}

// ---------- phase 2: enabled with a throwaway key ----------
const token = `bwk_smoke_${randomBytes(24).toString("hex")}`;
const otherToken = `bwk_smoke_${randomBytes(24).toString("hex")}`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const keys = [
  { id: "smoke-agent", label: "Smoke Agent", sha256: sha(token), scopes: ["quote", "order:write", "order:read"], maxActiveOrders: 3, webhook: null },
  { id: "smoke-other", label: "Other Agent", sha256: sha(otherToken), scopes: ["quote", "order:write", "order:read"], maxActiveOrders: 3, webhook: null },
];
const dataDir = mkdtempSync(join(tmpdir(), "bw-order-smoke-"));
log(`phase 2: bundled server with ORDER_DESK_ENABLED=true (speed ${speed}, zone ${zone})`);
const on = await startServer({ ORDER_DESK_ENABLED: "true", ORDER_DATA_DIR: dataDir, BRICKWORKS_AGENT_KEYS: JSON.stringify(keys), ORDER_FLOOR_PUBLIC_VIEW: "true" });
const summary = { speed, zone };
try {
  const base = on.base;
  const operator = (path, body) => fetch(`${base}/api/order-floor/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const status = await json(await fetch(`${base}/api/order-floor/status`));
  check("on: floor active", () => assert.deepEqual([status.enabled, status.active], [true, true]));
  if (speed !== 1) {
    const result = await json(await operator("command", { command: { id: `smoke-speed-${Date.now()}`, type: "speed", value: speed } }));
    check(`on: operator set floor speed ${speed}`, () => assert.equal(result.ok, true));
  }

  const connect = async (bearer) => {
    const client = new Client({ name: "brickworks-order-smoke", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
    await client.connect(transport);
    return client;
  };
  const client = await connect(token);
  const call = async (name, input) => {
    const result = await client.callTool({ name, arguments: input });
    if (result.isError) throw Object.assign(new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`), { result });
    return result.structuredContent;
  };
  const tools = await client.listTools();
  check("on: tools/list returns exactly 8 tools with output schemas", () => {
    assert.equal(tools.tools.length, 8);
    for (const tool of tools.tools) assert.ok(tool.outputSchema, tool.name);
  });
  const catalog = await call("list_vehicle_configs", {});
  const capabilities = await call("get_capabilities", {});
  check("on: catalog and capabilities are virtual and omit the seed", () => {
    assert.equal(catalog.virtual, true);
    assert.equal(capabilities.virtual, true);
    assert.equal(/"seed"/.test(JSON.stringify(capabilities)), false);
  });
  const model = catalog.models[0];
  const config = { modelId: model.modelId, options: { finish: "gold", seats: 2 } };
  const quoteStarted = Date.now();
  const quote = await call("quote_vehicle", { config, quantity: 1, destinationZone: zone, leadOptions: ["standard", "expedite"] });
  summary.quoteLatencyMs = Date.now() - quoteStarted;
  check("on: quote is manufacturable with forecast lead options", () => {
    assert.equal(quote.feasibility.manufacturable, true);
    assert.equal(quote.leadOptions.length, 2);
    for (const option of quote.leadOptions) assert.equal(option.source ?? "forecast", "forecast");
  });
  const lead = quote.leadOptions.find((option) => option.name === "standard");
  summary.quotedShipBySimTime = lead.shipBySimTime;
  const idempotencyKey = `smoke-${randomBytes(6).toString("hex")}`;
  const placed = await call("place_order", { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey });
  const replay = await call("place_order", { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey });
  const orderId = placed.order.orderId;
  summary.orderId = orderId;
  check("on: place_order is idempotent (replayed: true, same id)", () => {
    assert.equal(replay.replayed, true);
    assert.equal(replay.order.orderId, orderId);
  });
  log(`placed ${orderId}; following updates`);

  let notifications = 0;
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    if (notification.params.uri === `brickworks://orders/${orderId}`) notifications++;
  });
  await client.subscribeResource({ uri: `brickworks://orders/${orderId}` });

  const other = await connect(otherToken);
  const foreign = await other.callTool({ name: "get_order", arguments: { orderId } });
  check("on: a second agent cannot read the order (ORDER_NOT_FOUND)", () => {
    assert.equal(foreign.isError, true);
    assert.match(JSON.stringify(foreign.structuredContent ?? foreign.content), /ORDER_NOT_FOUND/);
  });
  check("on: MCP error body carries virtual:true and the disclaimer", () => {
    const body = JSON.parse(foreign.content[0].text);
    assert.equal(body.virtual, true);
    assert.ok(body.disclaimer);
  });
  await other.close();

  const statuses = [];
  let cursor;
  let lastOrder;
  let delivered = false;
  let factoryLinked = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await call("get_order_updates", { orderId, ...(cursor ? { cursor } : {}), limit: 100, waitSeconds: 20 });
    cursor = page.nextCursor;
    for (const update of page.updates) {
      if (update.source === "simulated" && statuses.at(-1) !== update.status) statuses.push(update.status);
      if (update.factoryEvent) factoryLinked++;
      if (update.type !== "estimate.revised") log(`update ${update.seq} ${update.type} -> ${update.status} @ sim ${update.simTime.toFixed(1)}s`);
    }
    lastOrder = (await call("get_order", { orderId })).order;
    if (lastOrder.status === "delivered") {
      delivered = true;
      break;
    }
  }
  summary.statuses = statuses;
  summary.wallSecondsToDelivery = Math.round((Date.now() - quoteStarted) / 1000);
  summary.resourceNotifications = notifications;
  const unit = lastOrder?.units?.[0];
  summary.tracking = unit?.tracking ? { carrier: unit.tracking.carrier, legs: unit.tracking.legs.length, etaSimTime: unit.tracking.etaSimTime } : null;
  check(`on: order delivered within ${timeoutMs / 60000} wall minutes`, () => assert.equal(delivered, true));
  check("on: status sequence covers placed through delivered", () => {
    for (const expected of ["placed", "scheduled", "in_production", "quality_check", "shipped", "in_transit", "delivered"]) assert.ok(statuses.includes(expected), `missing ${expected}`);
  });
  check("on: factory-sourced updates link factory event ids", () => assert.ok(factoryLinked > 0));
  check("on: get_order shows virtual carrier tracking legs", () => assert.ok(unit?.tracking?.legs?.length > 0));
  check("on: resource subscription delivered notifications/resources/updated", () => assert.ok(notifications > 0));
  const feed = await call("get_order_updates", { orderId, limit: 100 });
  const listed = await call("list_orders", {});
  check("on: list_orders and get_order_updates carry virtual:true and the disclaimer", () => {
    for (const body of [feed, listed]) {
      assert.equal(body.virtual, true);
      assert.ok(body.disclaimer);
    }
  });
  const shippedUpdate = feed.updates.find((update) => update.status === "shipped" && update.type !== "estimate.revised");
  summary.actualShipSimTime = shippedUpdate?.simTime ?? null;
  if (speed === 1)
    check("on: actual ship time equals quoted shipBySimTime (speed 1, no other inputs)", () => assert.equal(summary.actualShipSimTime, summary.quotedShipBySimTime));

  const restOrder = await fetch(`${base}/api/agent/v1/orders/${orderId}`, { headers: { authorization: `Bearer ${token}` } });
  check("on: REST mirror returns the same order", () => assert.equal(restOrder.status, 200));
  const noKey = await fetch(`${base}/api/agent/v1/orders`);
  const noKeyBody = await noKey.json();
  check("on: REST list without a key is 401, with virtual:true in the error body", () => {
    assert.equal(noKey.status, 401);
    assert.equal(noKeyBody.virtual, true);
  });

  // ---------- kill switch ----------
  const thrown = await json(await operator("kill-switch", { thrown: true }));
  check("kill switch: thrown, desk inactive", () => assert.deepEqual([thrown.killSwitch, thrown.active], [true, false]));
  let mcpBlocked = false;
  try {
    const result = await client.callTool({ name: "get_capabilities", arguments: {} });
    mcpBlocked = result.isError === true && /ORDER_DESK_DISABLED/.test(JSON.stringify(result));
  } catch {
    mcpBlocked = true;
  }
  const restBlocked = await fetch(`${base}/api/agent/v1/catalog`);
  const freshMcp = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  check("kill switch: existing MCP session call blocked", () => assert.equal(mcpBlocked, true));
  check("kill switch: new MCP request 503", () => assert.equal(freshMcp.status, 503));
  const restBlockedBody = await restBlocked.json();
  check("kill switch: REST 503 ORDER_DESK_DISABLED, with virtual:true in the error body", () => {
    assert.equal(restBlocked.status, 503);
    assert.equal(restBlockedBody.error.code, "ORDER_DESK_DISABLED");
    assert.equal(restBlockedBody.virtual, true);
  });
  const released = await json(await operator("kill-switch", { thrown: false }));
  check("kill switch: released, desk active again", () => assert.deepEqual([released.killSwitch, released.active], [false, true]));
  const after = await connect(token);
  const afterCaps = await after.callTool({ name: "get_capabilities", arguments: {} });
  check("kill switch: calls work again after release", () => assert.notEqual(afterCaps.isError, true));
  await after.close();
  await client.close().catch(() => undefined);

  const logs = on.output.join("");
  check("logs contain no bearer keys or key hashes", () => {
    for (const secret of [token, otherToken, sha(token), sha(otherToken)]) assert.equal(logs.includes(secret), false);
  });
} catch (error) {
  results.push({ name: "unexpected error", ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });
} finally {
  await stopServer(on);
  rmSync(dataDir, { recursive: true, force: true });
}

const passed = results.filter((result) => result.ok).length;
const failed = results.length - passed;
for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}${result.ok ? "" : `: ${result.error}`}`);
console.log(JSON.stringify({ passed, failed, ...summary }, null, 2));
process.exitCode = failed ? 1 : 0;
