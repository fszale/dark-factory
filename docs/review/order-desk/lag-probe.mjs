// DF-ORDER-001 live-stream lag probe (local only, never against a deployment).
// QA item 34 saw the page lag the live stream by minutes on a software-GL machine at about 1 FPS.
// This spawns the bundled server (`npm run build` first) with the desk on, a throwaway agent key and
// operator code held in memory, opens the Orders tab in headless Chrome with SwiftShader (about 1 FPS),
// sets the floor to speed 10, places an order every 3 minutes, and once a minute compares the server
// floor clock with the clocks the page shows. Notes go to lag-probe-notes.txt in this folder.
// Not part of CI: needs `playwright-core` installed outside the repo and a Chrome binary, for example
//   mkdir -p /tmp/df-browser && cd /tmp/df-browser && npm i playwright-core@1
//   NODE_PATH=/tmp/df-browser/node_modules CHROME_PATH=/usr/bin/google-chrome PROBE_MINUTES=10 node docs/review/order-desk/lag-probe.mjs
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.env.NODE_PATH ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const token = `bwk_ui_${randomBytes(24).toString("hex")}`;
const code = `op-${randomBytes(12).toString("hex")}`;
const sha = createHash("sha256").update(token).digest("hex");
const port = 3918;
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
const toSec = (t) => { if (!t) return null; const p = t.split(":").map(Number); return p.reduce((a, b) => a * 60 + b, 0); };
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "Open details panel" }).click();
  await page.locator(".panel-tabs").getByRole("button", { name: "Orders" }).click();
  await page.getByRole("tab", { name: "Order floor" }).click();
  await page.getByLabel("Watch order floor").check();
  await page.waitForTimeout(3000);
  note(`speed 10: ${JSON.stringify(await operator({ type: "speed", value: 10 }))}`);
  const minutes = Number(process.env.PROBE_MINUTES ?? 10);
  for (let m = 1; m <= minutes; m++) {
    if (m % 3 === 1) {
      const q = await api("/api/agent/v1/quotes", { method: "POST", body: JSON.stringify({ config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold", seats: 2 } }, quantity: 1, destinationZone: "zone-local", leadOptions: ["standard"] }) });
      const o = await api("/api/agent/v1/orders", { method: "POST", headers: { "idempotency-key": `lag-probe-${m}-${Date.now()}` }, body: JSON.stringify({ quoteId: q.body?.quoteId, leadOption: "standard" }) });
      note(`minute ${m}: placed order status ${o.status}`);
    }
    await sleep(60_000);
    const server = (await (await fetch(`${base}/api/order-floor/view`)).json()).simTime;
    const ui = await page.evaluate(() => document.body.innerText);
    const header = toSec((ui.match(/LIVE SIMULATION\s+(\d+:\d+(?::\d+)?)/) || [])[1]);
    const floor = toSec((ui.match(/Floor time ([\d:]+)/) || [])[1]);
    const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
    note(`minute ${m}: server floor sim ${server.toFixed(1)} s; UI header clock ${header} s (behind ${(server - header).toFixed(1)} s); UI desk floor time ${floor} s (behind ${(server - floor).toFixed(1)} s); rAF ${fps.toFixed(1)} fps`);
  }
} catch (error) {
  note(`ERROR ${error instanceof Error ? error.stack : error}`);
} finally {
  note(`console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`);
  note(`server log contains key or code: ${serverLog.includes(token) || serverLog.includes(code)}`);
  writeFileSync(join(here, "lag-probe-notes.txt"), notes.join("\n") + "\n");
  await browser.close();
  server.kill("SIGTERM");
}
