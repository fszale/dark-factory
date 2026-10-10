import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { withVirtualNotice, type OrderUpdate } from "../../../../packages/contracts/src/orders.ts";
import type { DeskLogger } from "../../../../packages/orders/src/desk.ts";

export const WEBHOOK_SIGNATURE_HEADER = "X-Brickworks-Signature";
export const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

export const signWebhook = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function ipv4Private(address: string) {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and IPv4-mapped private addresses. */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return ipv4Private(address);
  if (kind !== 6) return true;
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return ipv4Private(mapped[1]);
  if (value.startsWith("::ffff:")) return true;
  const first = parseInt(value.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    value.startsWith("2001:db8") ||
    value.startsWith("64:ff9b")
  );
}

export interface WebhookTarget {
  url: string;
  secret: string;
}

export interface WebhookOptions {
  enabled: boolean;
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  retryDelaysMs?: number[];
  logger: DeskLogger;
}

const defaultResolve = async (hostname: string) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Outbound order update delivery. Off by default. The URL comes only from
 * Filip's key configuration, never from an agent. HTTPS only, every resolved
 * address must be public, redirects are not followed, the body is one
 * orderUpdate signed with HMAC-SHA256, and failures retry 3 times with
 * backoff. Polling stays the source of truth; receivers dedupe by seq.
 */
export class WebhookDispatcher {
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;
  readonly delivered: Array<{ seq: number; attempt: number; status: number | string }> = [];

  constructor(private readonly options: WebhookOptions) {}

  async check(target: WebhookTarget): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(target.url);
    } catch {
      return "invalid url";
    }
    if (url.protocol !== "https:") return "https only";
    if (url.username || url.password) return "credentials in url";
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return "private host";
    const addresses = isIP(host) ? [host] : await (this.options.resolve ?? defaultResolve)(host).catch(() => []);
    if (!addresses.length) return "unresolvable host";
    if (addresses.some(isBlockedAddress)) return "private address";
    return null;
  }

  deliver(target: WebhookTarget, update: OrderUpdate) {
    if (!this.options.enabled || this.closed) return;
    void this.attempt(target, update, 0);
  }

  private async attempt(target: WebhookTarget, update: OrderUpdate, attempt: number) {
    if (this.closed) return;
    const problem = await this.check(target);
    if (problem) {
      // A misconfigured target is not retried; logs carry no URL or secret.
      this.delivered.push({ seq: update.seq, attempt, status: `blocked: ${problem}` });
      this.options.logger.warn({ orderId: update.orderId, seq: update.seq, reason: problem }, "order webhook blocked");
      return;
    }
    const body = JSON.stringify(withVirtualNotice(update));
    let status: number | string;
    try {
      const response = await (this.options.fetch ?? fetch)(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [WEBHOOK_SIGNATURE_HEADER]: signWebhook(target.secret, body), "User-Agent": "brickworks-order-desk/1 (virtual)" },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      if (response.status >= 200 && response.status < 300) {
        this.delivered.push({ seq: update.seq, attempt, status });
        return;
      }
    } catch (error) {
      status = error instanceof Error ? error.name : "error";
    }
    this.delivered.push({ seq: update.seq, attempt, status });
    const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    if (attempt >= delays.length) {
      this.options.logger.warn({ orderId: update.orderId, seq: update.seq, attempts: attempt + 1 }, "order webhook gave up; update remains available by polling");
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.attempt(target, update, attempt + 1);
    }, delays[attempt]);
    timer.unref();
    this.timers.add(timer);
  }

  close() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
