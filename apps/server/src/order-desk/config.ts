import { resolve } from "node:path";
import { z } from "zod";
import { SCENARIOS, type RunExport } from "../../../../packages/contracts/src/index.ts";
import { AGENT_SCOPES } from "../../../../packages/contracts/src/orders.ts";
import type { ForecastRequest, ForecastResult } from "../../../../packages/orders/src/forecast.ts";

/** One configured agent key. Only the SHA-256 of the key is ever stored. */
export const agentKeySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
    label: z.string().min(1).max(80),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    scopes: z.array(z.enum(AGENT_SCOPES)).min(1),
    maxActiveOrders: z.number().int().min(1).max(10).default(3),
    webhook: z
      .object({ url: z.string().url().max(500), secret: z.string().min(16).max(200) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type AgentKeyConfig = z.infer<typeof agentKeySchema>;

export interface RateLimits {
  perAgentPerMinute: number;
  quotePerMinute: number;
  placePerMinute: number;
  placePerDay: number;
  concurrentStreams: number;
  anonymousPerMinute: number;
  forecastQueue: number;
}
export const DEFAULT_RATE_LIMITS: RateLimits = {
  perAgentPerMinute: 60,
  quotePerMinute: 10,
  placePerMinute: 3,
  placePerDay: 20,
  concurrentStreams: 2,
  anonymousPerMinute: 20,
  forecastQueue: 5,
};

export type Forecaster = (run: RunExport, request: ForecastRequest) => Promise<ForecastResult>;

/** BuildAppOptions.orderDesk. Every field falls back to the environment, then to a safe default. */
export interface OrderDeskOptions {
  enabled?: boolean;
  anonRead?: boolean;
  scenario?: (typeof SCENARIOS)[number];
  seed?: number;
  publicView?: boolean;
  publicBaseUrl?: string;
  dataDir?: string;
  quoteTtlMs?: number;
  deliveryTimeScale?: number;
  webhooksEnabled?: boolean;
  agentKeys?: AgentKeyConfig[] | string;
  /** Tests: the floor advances only through advanceFloor(). */
  manualClock?: boolean;
  forecaster?: Forecaster;
  now?: () => number;
  rateLimits?: Partial<RateLimits>;
  persistDebounceMs?: number;
  mcpSessionIdleMs?: number;
  maxMcpSessions?: number;
  /** Webhook test seams; production uses global fetch and DNS. */
  webhookFetch?: typeof fetch;
  webhookResolve?: (hostname: string) => Promise<string[]>;
  webhookRetryDelaysMs?: number[];
}

export interface OrderDeskConfig {
  enabled: boolean;
  anonRead: boolean;
  scenario: (typeof SCENARIOS)[number];
  seed: number;
  publicView: boolean;
  publicBaseUrl: string | null;
  dataDir: string;
  quoteTtlMs: number;
  deliveryTimeScale: number;
  webhooksEnabled: boolean;
  agentKeys: AgentKeyConfig[];
  agentKeyError: string | null;
  manualClock: boolean;
  rateLimits: RateLimits;
  persistDebounceMs: number;
  mcpSessionIdleMs: number;
  maxMcpSessions: number;
}

const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === "" ? fallback : value.trim().toLowerCase() === "true";
const number = (value: string | number | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

/** Parse BRICKWORKS_AGENT_KEYS. A malformed value disables every key instead of partially trusting it. */
export function parseAgentKeys(raw: AgentKeyConfig[] | string | undefined): { keys: AgentKeyConfig[]; error: string | null } {
  if (raw === undefined || raw === "") return { keys: [], error: null };
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const keys = z.array(agentKeySchema).max(100).parse(value);
    if (new Set(keys.map((k) => k.id)).size !== keys.length) throw new Error("duplicate agent id");
    if (new Set(keys.map((k) => k.sha256)).size !== keys.length) throw new Error("duplicate key hash");
    return { keys, error: null };
  } catch (error) {
    // Never echo the raw value: it is a secret.
    return { keys: [], error: error instanceof Error ? error.message.slice(0, 200) : "invalid" };
  }
}

export function resolveOrderDeskConfig(options: OrderDeskOptions = {}, env: NodeJS.ProcessEnv = process.env): OrderDeskConfig {
  const fromEnv = (SCENARIOS as readonly string[]).includes(env.ORDER_FLOOR_SCENARIO ?? "")
    ? (env.ORDER_FLOOR_SCENARIO as (typeof SCENARIOS)[number])
    : "balanced";
  const scenario = options.scenario ?? fromEnv;
  const base = options.publicBaseUrl ?? env.PUBLIC_BASE_URL ?? "";
  let publicBaseUrl: string | null = null;
  if (base) {
    try {
      const url = new URL(base);
      if (url.protocol === "https:" || url.protocol === "http:") publicBaseUrl = url.origin;
    } catch {
      publicBaseUrl = null;
    }
  }
  const keys = parseAgentKeys(options.agentKeys ?? env.BRICKWORKS_AGENT_KEYS);
  return {
    // Off by default: only the literal "true" turns the desk on.
    enabled: options.enabled ?? flag(env.ORDER_DESK_ENABLED, false),
    anonRead: options.anonRead ?? flag(env.ORDER_DESK_ANON_READ, true),
    scenario,
    seed: Math.trunc(options.seed ?? number(env.ORDER_FLOOR_SEED, 42, 0, 2 ** 31 - 1)),
    publicView: options.publicView ?? flag(env.ORDER_FLOOR_PUBLIC_VIEW, false),
    publicBaseUrl,
    dataDir: resolve(process.cwd(), options.dataDir ?? env.ORDER_DATA_DIR ?? ".data/orders"),
    quoteTtlMs: options.quoteTtlMs ?? number(env.ORDER_QUOTE_TTL_MS, 10 * 60_000, 10_000, 60 * 60_000),
    deliveryTimeScale: options.deliveryTimeScale ?? number(env.ORDER_DELIVERY_TIME_SCALE, 1, 0.01, 10),
    webhooksEnabled: options.webhooksEnabled ?? flag(env.ORDER_WEBHOOKS_ENABLED, false),
    agentKeys: keys.keys,
    agentKeyError: keys.error,
    manualClock: options.manualClock ?? false,
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...options.rateLimits },
    persistDebounceMs: options.persistDebounceMs ?? 1000,
    mcpSessionIdleMs: options.mcpSessionIdleMs ?? 15 * 60_000,
    maxMcpSessions: options.maxMcpSessions ?? 50,
  };
}
