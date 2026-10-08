#!/usr/bin/env node
/**
 * DF-ORDER-001 soak with the order desk enabled (local only, never against a deployment).
 *
 * Requires `npm run build`. Starts the bundled server on 127.0.0.1 with ORDER_DESK_ENABLED=true,
 * a public read-only floor view and a throwaway agent key generated in memory (only its sha256
 * reaches the server). It then runs, in parallel for SOAK_SECONDS (default 1800):
 *   - the existing visitor-session soak (`scripts/soak.mjs`, speed 10, unchanged);
 *   - an agent that places a virtual order over REST every 120 wall seconds when it has
 *     fewer than 3 active orders;
 *   - a floor viewer on /api/live counting snapshot and orders frames;
 *   - a sampler (every 60 s) that reads the operator export to check floor conservation and
 *     ledger deltas, event and update log bounds, plus /api/health memory and tick timings.
 * Writes docs/review/order-desk-soak.json and docs/review/order-desk-soak-session.json.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const duration = Number(process.env.SOAK_SECONDS || 1800);
const port = Number(process.env.SOAK_PORT || 3931);
const base = `http://127.0.0.1:${port}`;
const out = join(root, "docs/review/order-desk-soak.json");
const token = `bwk_soak_${randomBytes(24).toString("hex")}`;
const sha = createHash("sha256").update(token).digest("hex");
const dataDir = mkdtempSync(join(tmpdir(), "bw-order-soak-"));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(ORDER_|BRICKWORKS_|PUBLIC_BASE_URL|ACCESS_CODE|PUBLIC_MODE|TYPESAFE_|OPENAI_|XAI_)/.test(key)) delete env[key];
Object.assign(env, {
  NODE_ENV: "production",
  PORT: String(port),
  ORDER_DESK_ENABLED: "true",
  ORDER_FLOOR_PUBLIC_VIEW: "true",
  ORDER_DATA_DIR: dataDir,
  BRICKWORKS_AGENT_KEYS: JSON.stringify([{ id: "soak-agent", label: "Soak Agent", sha256: sha, scopes: ["quote", "order:write", "order:read"], maxActiveOrders: 3, webhook: null }]),
});
const server = spawn(process.execPath, ["dist/server/index.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (c) => (serverLog = (serverLog + c).slice(-2_000_000)));
server.stderr.on("data", (c) => (serverLog = (serverLog + c).slice(-2_000_000)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await sleep(200);
}
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const getJson = async (path, headers = {}) => {
  const response = await fetch(base + path, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
};

// Session soak (unchanged script) against the same server.
const sessionSoak = spawn(process.execPath, ["scripts/soak.mjs"], {
  cwd: root,
  env: { ...process.env, BRICKWORKS_TEST_URL: base, SOAK_SECONDS: String(duration), SOAK_OUTPUT: "../docs/review/order-desk-soak-session.json" },
  stdio: ["ignore", "pipe", "pipe"],
});
let sessionOutput = "";
sessionSoak.stdout.on("data", (c) => (sessionOutput += c));
sessionSoak.stderr.on("data", (c) => (sessionOutput += c));
const sessionDone = new Promise((ok) => sessionSoak.once("exit", (code) => ok(code)));

// Floor viewer.
let floorFrames = 0;
let ordersFrames = 0;
let floorErrors = 0;
let floorClosed = false;
const floor = new WebSocket(`${base.replace("http", "ws")}/api/live`);
floor.onopen = () => floor.send(JSON.stringify({ view: "order-floor" }));
floor.onmessage = (event) => {
  const type = JSON.parse(event.data).type;
  if (type === "orders") ordersFrames++;
  else floorFrames++;
};
floor.onerror = () => floorErrors++;
floor.onclose = () => (floorClosed = true);

const began = Date.now();
const samples = [];
const orders = { placed: 0, refused: 0, errors: [] };
let lastOrderAt = 0;
let status = "running";
let failure = null;
const persist = () =>
  writeFileSync(
    out,
    JSON.stringify(
      {
        status,
        ...(failure ? { error: failure } : {}),
        startedAt: new Date(began).toISOString(),
        durationSeconds: duration,
        note: "Local bundled server, order desk enabled, virtual orders only, throwaway key held in memory. Not deployed.",
        orders,
        samples,
      },
      null,
      2,
    ),
  );

async function placeOrder() {
  const list = await getJson("/api/agent/v1/orders?limit=50", auth);
  const active = list.orders.filter((o) => !["delivered", "cancelled", "failed"].includes(o.status)).length;
  if (active >= 3) return;
  const zones = ["zone-local", "zone-metro", "zone-regional"];
  const quote = await fetch(`${base}/api/agent/v1/quotes`, { method: "POST", headers: auth, body: JSON.stringify({ config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold" } }, quantity: 1 + (orders.placed % 2), destinationZone: zones[orders.placed % zones.length], leadOptions: ["standard", "expedite"] }) }).then((r) => r.json());
  if (!quote.quoteId) {
    orders.refused++;
    return;
  }
  const response = await fetch(`${base}/api/agent/v1/orders`, { method: "POST", headers: { ...auth, "idempotency-key": `soak-${Date.now()}` }, body: JSON.stringify({ quoteId: quote.quoteId, leadOption: orders.placed % 2 ? "expedite" : "standard" }) });
  if (response.ok) orders.placed++;
  else orders.refused++;
}

async function sample() {
  const exported = await getJson("/api/order-floor/export");
  const s = exported.floorCheckpoint.snapshot;
  const held = Object.values(s.warehouse).reduce((a, b) => a + b, 0) + s.carts.reduce((n, c) => n + c.amount, 0) + Object.values(s.stations).reduce((n, x) => n + x.stock, 0);
  const materialDelta = s.metrics.initial + s.metrics.received - held - s.metrics.consumed;
  const ledgerDelta = s.orders.reduce((t, o) => t + o.quantity - o.completed, 0) - (s.metrics.orderedUnits - s.metrics.completed);
  const desk = await getJson("/api/order-floor/view");
  const health = await getJson("/api/health");
  const current = {
    wallSeconds: Math.round((Date.now() - began) / 1000),
    floorSimSeconds: s.time,
    materialDelta,
    receivingDelta: s.metrics.receivingConservationDelta ?? 0,
    ledgerDelta,
    floorEvents: s.events.length,
    floorSamples: s.samples.length,
    deskUpdates: exported.desk.updates.length,
    deskOrders: Object.keys(exported.desk.orders).length,
    deskMetrics: desk.metrics,
    floorFrames,
    ordersFrames,
    floorErrors,
    floorClosed,
    ...health.application,
  };
  samples.push(current);
  persist();
  if (materialDelta !== 0 || current.receivingDelta !== 0 || ledgerDelta !== 0) throw new Error(`floor conservation delta ${JSON.stringify({ materialDelta, ledgerDelta })}`);
  if (current.floorEvents > 2000 || current.floorSamples > 720) throw new Error("floor retention bound exceeded");
  if (current.deskUpdates > 5000) throw new Error("desk update log not bounded");
  if (floorErrors > 0 || floorClosed) throw new Error("floor stream error or close");
  if (samples.length > 1 && current.floorFrames <= samples.at(-2).floorFrames) throw new Error("floor stream stopped");
}

try {
  await sleep(2000);
  await sample();
  while (Date.now() - began < duration * 1000) {
    if (Date.now() - lastOrderAt >= 120_000) {
      lastOrderAt = Date.now();
      await placeOrder().catch((error) => orders.errors.push(String(error).slice(0, 200)));
    }
    await sleep(Math.min(60_000, Math.max(0, duration * 1000 - (Date.now() - began))));
    await sample();
  }
  const sessionCode = await sessionDone;
  if (sessionCode !== 0) throw new Error(`session soak exited ${sessionCode}: ${sessionOutput.slice(-500)}`);
  if (serverLog.includes(token) || serverLog.includes(sha)) throw new Error("server log contains the agent key or its hash");
  if (orders.placed === 0) throw new Error("no agent orders were placed");
  status = "passed";
  persist();
  console.log(`Order desk soak passed: ${samples.length} samples, ${orders.placed} orders placed, ${samples.at(-1).deskMetrics.delivered} delivered.`);
} catch (error) {
  status = "failed";
  failure = String(error);
  persist();
  console.error(`Order desk soak failed: ${failure}`);
  process.exitCode = 1;
} finally {
  floor.close();
  sessionSoak.kill("SIGTERM");
  server.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}
