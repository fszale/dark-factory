import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type BuildAppOptions } from "../../apps/server/src/app.ts";
import { getOrderDeskRuntime } from "../../apps/server/src/order-desk/index.ts";
import type { AgentKeyConfig, OrderDeskOptions } from "../../apps/server/src/order-desk/config.ts";

/** Throwaway test keys generated per run; only their hashes go into the server config. */
export function testKeys() {
  const make = (id: string, scopes: AgentKeyConfig["scopes"], maxActiveOrders = 3) => {
    const key = `bwk_${id}_${randomBytes(24).toString("base64url")}`;
    const config: AgentKeyConfig = { id, label: `Test ${id}`, sha256: createHash("sha256").update(key).digest("hex"), scopes, maxActiveOrders, webhook: null };
    return { key, config, auth: { authorization: `Bearer ${key}` } };
  };
  return {
    a: make("test-agent", ["quote", "order:write", "order:read"]),
    b: make("agent-b", ["quote", "order:write", "order:read"]),
    reader: make("reader-only", ["order:read"]),
  };
}

export async function orderApp(overrides: Partial<OrderDeskOptions> = {}, appOptions: Partial<BuildAppOptions> = {}) {
  const keys = testKeys();
  const dataDir = overrides.dataDir ?? mkdtempSync(join(tmpdir(), "brickworks-orders-"));
  const app = await buildApp({
    tickMs: 10_000,
    ...appOptions,
    orderDesk: {
      enabled: true,
      manualClock: true,
      dataDir,
      agentKeys: [keys.a.config, keys.b.config, keys.reader.config],
      deliveryTimeScale: 0.05,
      persistDebounceMs: 10,
      ...overrides,
    },
  });
  const runtime = getOrderDeskRuntime(app)!;
  return { app, keys, runtime, dataDir, advance: (seconds: number) => runtime.floor().advance(seconds) };
}

export const quoteBody = (quantity = 1, zone = "zone-local") => ({
  config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold", seats: 2 } },
  quantity,
  destinationZone: zone,
  leadOptions: ["standard", "expedite"],
});
