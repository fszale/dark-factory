// DF-ORDER-001 browser check driver (local only, never against a deployment).
// Spawns the bundled server (`npm run build` first) with the desk on, a throwaway agent key and a
// throwaway operator code held in memory, drives headless Chrome, and saves the screenshots in this folder.
// Not part of CI: needs `playwright-core` installed outside the repo and a Chrome binary, for example
//   mkdir -p /tmp/df-browser && cd /tmp/df-browser && npm i playwright-core@1
//   NODE_PATH=/tmp/df-browser/node_modules CHROME_PATH=/usr/bin/google-chrome node docs/review/order-desk/browser-check.mjs
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(join(process.env.NODE_PATH ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

const repo = resolve(import.meta.dirname, "../../..");
const out = join(repo, "docs/review/order-desk");
mkdirSync(out, { recursive: true });
const token = `bwk_ui_${randomBytes(24).toString("hex")}`;
const code = `op-${randomBytes(12).toString("hex")}`;
const sha = createHash("sha256").update(token).digest("hex");
const port = 3917;
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(ORDER_|BRICKWORKS_|ACCESS_CODE|PUBLIC_MODE)/.test(key)) delete env[key];
Object.assign(env, {
  NODE_ENV: "production",
  PORT: String(port),
  ORDER_DESK_ENABLED: "true",
  ORDER_FLOOR_PUBLIC_VIEW: "true",
  ORDER_DATA_DIR: mkdtempSync(join(tmpdir(), "bw-order-ui-")),
  BRICKWORKS_ACCESS_CODE: code,
  BRICKWORKS_AGENT_KEYS: JSON.stringify([{ id: "test-agent", label: "Test Agent", sha256: sha, scopes: ["quote", "order:write", "order:read"], maxActiveOrders: 3, webhook: null }]),
});
const server = spawn(process.execPath, ["dist/server/index.js"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (c) => (serverLog += c));
server.stderr.on("data", (c) => (serverLog += c));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await sleep(200);
}
const notes = [];
const note = (line) => {
  const stamp = new Date().toISOString();
  notes.push(`${stamp} ${line}`);
  console.log(line);
};
const api = async (path, init = {}) => {
  const response = await fetch(base + path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const operator = (body) => fetch(`${base}/api/order-floor/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode: code, command: { id: `ui-${Date.now()}`, ...body } }) }).then((r) => r.json());

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const shot = async (name, what) => {
  await page.screenshot({ path: join(out, name) });
  note(`screenshot ${name}: ${what}`);
};
const orderStatus = async (orderId) => (await api(`/api/agent/v1/orders/${orderId}`)).body?.order;
const waitFor = async (orderId, predicate, maxMs) => {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const order = await orderStatus(orderId);
    if (order && predicate(order)) return order;
    await sleep(500);
  }
  throw new Error("timed out waiting for order state");
};
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "Open details panel" }).click();
  await page.locator(".panel-tabs").getByRole("button", { name: "Orders" }).click();
  await page.getByRole("tab", { name: "Order floor" }).click();
  await page.getByLabel("Watch order floor").check();
  await page.waitForTimeout(3000);
  const banner = await page.locator(".floor-banner").textContent();
  const dockInert = await page.locator(".control-dock").evaluate((el) => el.inert === true);
  note(`floor banner: "${banner}"; control dock inert without code: ${dockInert}`);
  await shot("01-floor-read-only.png", "floor view with read-only banner, controls dimmed and inert, no agent orders yet");

  const quote = await api("/api/agent/v1/quotes", { method: "POST", body: JSON.stringify({ config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold", seats: 2 } }, quantity: 1, destinationZone: "zone-metro", leadOptions: ["standard", "expedite"] }) });
  const placed = await api("/api/agent/v1/orders", { method: "POST", headers: { "idempotency-key": `ui-check-${Date.now()}` }, body: JSON.stringify({ quoteId: quote.body.quoteId, leadOption: "expedite" }) });
  const orderId = placed.body.order.orderId;
  note(`placed ${orderId} via REST with a throwaway local key (quote ${quote.status}, order ${placed.status})`);
  await page.locator(".order-toast").waitFor({ timeout: 5000 });
  note(`toast: "${await page.locator(".order-toast").textContent()}"`);
  await shot("02-incoming-order-toast.png", "toast and feed row for the incoming agent order plus its card");
  await page.getByRole("button", { name: "Show unit detail" }).first().click();
  await page.waitForTimeout(500);
  await page.locator(".station-chip").first().scrollIntoViewIfNeeded();
  const projected = await page.locator(".station-chip.projected").count();
  note(`projected chips visible before commitment: ${projected}`);
  await shot("03-projected-chips.png", "unit detail before commitment: dashed projected station chips");

  await waitFor(orderId, (o) => o.units[0].stations.front.binding === "bound", 180_000);
  await page.waitForTimeout(1500);
  if (!(await page.locator(".station-chip").count())) await page.getByRole("button", { name: "Show unit detail" }).first().click();
  const bound = await page.locator(".station-chip.bound").count();
  note(`bound chips after commitment: ${bound}`);
  await page.locator(".station-chip.bound").first().scrollIntoViewIfNeeded();
  await shot("04-bound-chips.png", "unit committed: solid bound chips with module id and lot");

  const vehicle = page.locator(".vehicle-link").first();
  const vehicleId = (await vehicle.textContent())?.trim();
  await vehicle.click();
  await page.waitForTimeout(1200);
  const inspectorText = await page.locator(".right-panel").textContent();
  note(`clicked vehicle ${vehicleId}; inspector shows agent order row: ${Boolean(inspectorText?.includes("Agent order") && inspectorText?.includes(orderId))}; follow button: ${await page.getByRole("button", { name: "Follow vehicle" }).count()}`);
  await shot("05-inspector-link.png", "vehicle selected in the Inspector with the Agent order row and Follow vehicle");
  note(`operator speed 10: ${JSON.stringify(await operator({ type: "speed", value: 10 }))}`);

  await page.locator(".panel-tabs").getByRole("button", { name: "Orders" }).click();
  await page.getByRole("tab", { name: "Order floor" }).click();
  await waitFor(orderId, (o) => ["in_transit", "out_for_delivery", "delivered"].includes(o.status), 600_000);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Show unit detail" }).first().click();
  await page.waitForTimeout(500);
  note(`tracking strip visible: ${await page.locator(".tracking-strip").count()}`);
  await page.locator(".tracking-strip").first().scrollIntoViewIfNeeded();
  await shot("06-tracking-strip.png", "virtual carrier tracking strip with legs and ETA while in transit");

  await waitFor(orderId, (o) => o.status === "delivered", 900_000);
  await page.waitForTimeout(1500);
  if (!(await page.locator(".order-updates").count())) await page.getByRole("button", { name: "Show unit detail" }).first().click();
  await page.waitForTimeout(1200);
  note(`card status text: "${await page.locator(".order-status").first().textContent()}"`);
  await page.locator(".order-updates").first().scrollIntoViewIfNeeded();
  await shot("07-delivered.png", "order delivered; stepper complete; recent updates with factory event ids");

  await page.locator(".panel-tabs").getByRole("button", { name: "Metrics" }).click();
  await page.waitForTimeout(800);
  await shot("08-metrics-agent-orders.png", "Metrics drawer Agent orders group, labeled simulated");

  await page.locator(".panel-tabs").getByRole("button", { name: "Orders" }).click();
  await page.getByRole("tab", { name: "Order floor" }).click();
  await page.getByLabel("Operator access code").fill(code);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForTimeout(800);
  const dockInertAfter = await page.locator(".control-dock").evaluate((el) => el.inert === true);
  note(`after entering the operator code, control dock inert: ${dockInertAfter}`);
  await shot("09-operator-unlocked.png", "operator code accepted: controls enabled, ribbon notes operator controls");

  await page.getByLabel("Watch order floor").uncheck();
  await page.waitForTimeout(2500);
  note(`after leaving the floor, banner count: ${await page.locator(".floor-banner").count()}`);
  await page.getByRole("tab", { name: "This session" }).click();
  await page.waitForTimeout(500);
  await shot("10-this-session.png", "back on the visitor session: This session order list with cancel for queued orders");
  note(`console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`);
  note(`server log contains key or code: ${serverLog.includes(token) || serverLog.includes(sha) || serverLog.includes(code)}`);
} catch (error) {
  note(`ERROR ${error instanceof Error ? error.stack : error}`);
  await page.screenshot({ path: join(tmpdir(), "order-desk-browser-failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, "browser-check-notes.txt"), notes.join("\n") + "\n");
  await browser.close();
  server.kill("SIGTERM");
}
