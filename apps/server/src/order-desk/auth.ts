import { createHash, timingSafeEqual } from "node:crypto";
import type { AgentScope } from "../../../../packages/contracts/src/orders.ts";
import { OrderDeskError, type AgentIdentity } from "../../../../packages/orders/src/desk.ts";
import type { AgentKeyConfig, RateLimits } from "./config.ts";

export interface Agent extends AgentIdentity {
  webhook: AgentKeyConfig["webhook"];
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Bearer key lookup: hash, then constant-time compare against every configured hash. */
export class AgentKeyring {
  private readonly entries: Array<{ hash: Buffer; agent: Agent }>;
  constructor(keys: AgentKeyConfig[]) {
    this.entries = keys.map((key) => ({
      hash: Buffer.from(key.sha256, "hex"),
      agent: { id: key.id, label: key.label, scopes: [...key.scopes], maxActiveOrders: key.maxActiveOrders, webhook: key.webhook },
    }));
  }
  get size() {
    return this.entries.length;
  }
  authenticate(header: string | undefined): Agent | null {
    const match = /^Bearer\s+(\S{16,512})$/i.exec(header ?? "");
    if (!match) return null;
    const presented = createHash("sha256").update(match[1]).digest();
    let found: Agent | null = null;
    // Compare against every entry so timing does not reveal which key matched.
    for (const entry of this.entries) if (timingSafeEqual(presented, entry.hash)) found = entry.agent;
    return found;
  }
}

export function requireScope(agent: Agent | null, scope: AgentScope | null) {
  if (scope === null) return;
  if (!agent) throw new OrderDeskError("UNAUTHORIZED", "A bearer agent key is required for this call.");
  if (!agent.scopes.includes(scope)) throw new OrderDeskError("FORBIDDEN_SCOPE", `This key lacks the ${scope} scope.`);
}

/** In-process sliding windows, the same approach as the session provider limiter. */
export class SlidingWindows {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number) {}
  private live(bucket: string, windowMs: number) {
    const now = this.now();
    const list = (this.hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
    this.hits.set(bucket, list);
    return list;
  }
  /** Seconds until a slot frees when the window is full, otherwise null. Records nothing. */
  peek(bucket: string, limit: number, windowMs: number): number | null {
    const list = this.live(bucket, windowMs);
    if (list.length < limit) return null;
    return Math.max(1, Math.ceil((list[0] + windowMs - this.now()) / 1000));
  }
  record(bucket: string) {
    const list = this.hits.get(bucket) ?? [];
    list.push(this.now());
    this.hits.set(bucket, list);
  }
  /** Records a hit when allowed; returns seconds until a slot frees when not. */
  take(bucket: string, limit: number, windowMs: number): number | null {
    const retry = this.peek(bucket, limit, windowMs);
    if (retry === null) this.record(bucket);
    return retry;
  }
  /** All-or-nothing: records a hit in every window only when every window has room. */
  takeAll(windows: Array<{ bucket: string; limit: number; windowMs: number }>): number | null {
    for (const w of windows) {
      const retry = this.peek(w.bucket, w.limit, w.windowMs);
      if (retry !== null) return retry;
    }
    for (const w of windows) this.record(w.bucket);
    return null;
  }
  prune() {
    const now = this.now();
    for (const [key, list] of this.hits) if (!list.some((t) => now - t < 24 * 60 * 60_000)) this.hits.delete(key);
  }
}

/** Calls with a strict budget of their own, charged only when the request would otherwise proceed. */
export type BudgetedCall = "quote_vehicle" | "place_order";

/**
 * Two layers. The loose layer (admit, rejected) runs before validation and protects against
 * floods: anonymous calls per IP, authenticated calls per agent, failed auth per IP. The strict
 * layer (charge) holds the quote and place budgets and is charged last, after auth, validation,
 * the kill switch and the intake pause, so a rejected request never spends it.
 */
export class RateLimiter {
  private readonly windows: SlidingWindows;
  private readonly streams = new Map<string, number>();
  constructor(private readonly limits: RateLimits, now: () => number) {
    this.windows = new SlidingWindows(now);
  }
  private fail(retry: number) {
    return new OrderDeskError("RATE_LIMITED", "Rate limit reached; retry later.", true, { retryAfterSeconds: retry });
  }
  /** Loose flood limiter for every call that passed auth: per IP when anonymous, per agent otherwise. */
  admit(agent: Agent | null, ip: string) {
    const retry = agent
      ? this.windows.take(`agent:${agent.id}`, this.limits.perAgentPerMinute, 60_000)
      : this.windows.take(`anon:${ip}`, this.limits.anonymousPerMinute, 60_000);
    if (retry !== null) throw this.fail(retry);
  }
  /** Counts a failed auth or scope check against the per-IP flood window; returns the error to send. */
  rejected(ip: string, error: OrderDeskError): OrderDeskError {
    const retry = this.windows.take(`invalid:${ip}`, this.limits.invalidAuthPerMinute, 60_000);
    return retry === null ? error : this.fail(retry);
  }
  /** Strict budgets. Checks every window before recording any, so a refusal costs nothing. */
  charge(agent: Agent, call: BudgetedCall) {
    const retry =
      call === "quote_vehicle"
        ? this.windows.takeAll([{ bucket: `quote:${agent.id}`, limit: this.limits.quotePerMinute, windowMs: 60_000 }])
        : this.windows.takeAll([
            { bucket: `place:${agent.id}`, limit: this.limits.placePerMinute, windowMs: 60_000 },
            { bucket: `place-day:${agent.id}`, limit: this.limits.placePerDay, windowMs: 24 * 60 * 60_000 },
          ]);
    if (retry !== null) throw this.fail(retry);
  }
  /** Long polls and SSE streams share one per-agent concurrency budget. */
  openStream(agent: Agent): () => void {
    const open = this.streams.get(agent.id) ?? 0;
    if (open >= this.limits.concurrentStreams) throw this.fail(5);
    this.streams.set(agent.id, open + 1);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.streams.set(agent.id, Math.max(0, (this.streams.get(agent.id) ?? 1) - 1));
    };
  }
  prune() {
    this.windows.prune();
  }
}

/** Forecasts fork the floor; run one at a time with a short queue, then shed load with RATE_LIMITED. */
export class ForecastQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly maxQueue: number) {}
  get depth() {
    return this.waiting.length + this.running;
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= 1) {
      if (this.waiting.length >= this.maxQueue)
        throw new OrderDeskError("RATE_LIMITED", "The forecast queue is full; retry shortly.", true, { retryAfterSeconds: 5 });
      // The finishing task hands its slot straight to us, so concurrency never exceeds one.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.running++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
