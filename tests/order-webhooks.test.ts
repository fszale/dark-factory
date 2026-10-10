import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { isBlockedAddress, signWebhook, WebhookDispatcher, WEBHOOK_SIGNATURE_HEADER } from "../apps/server/src/order-desk/webhooks.ts";
import type { OrderUpdate } from "../packages/contracts/src/orders.ts";
import { orderApp, quoteBody } from "./helpers/order-server.ts";

const logger = { info: () => undefined, warn: () => undefined };
const update = { seq: 7, orderId: "ao-0000000001", type: "order.placed" } as unknown as OrderUpdate;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("order webhooks (task 14, flag off by default)", () => {
  it("blocks private, loopback, link-local and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1", "not-an-ip"])
      expect(isBlockedAddress(address), address).toBe(true);
    for (const address of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isBlockedAddress(address), address).toBe(false);
  });

  it("refuses http, localhost, credentials and hosts resolving to private space", async () => {
    const dispatcher = new WebhookDispatcher({ enabled: true, logger, resolve: async (host) => (host === "inside.example.test" ? ["10.0.0.5"] : ["93.184.216.34"]) });
    expect(await dispatcher.check({ url: "http://hooks.example.test/x", secret: "s".repeat(16) })).toBe("https only");
    expect(await dispatcher.check({ url: "https://localhost/x", secret: "s".repeat(16) })).toBe("private host");
    expect(await dispatcher.check({ url: "https://u:p@hooks.example.test/x", secret: "s".repeat(16) })).toBe("credentials in url");
    expect(await dispatcher.check({ url: "https://inside.example.test/x", secret: "s".repeat(16) })).toBe("private address");
    expect(await dispatcher.check({ url: "https://169.254.169.254/latest", secret: "s".repeat(16) })).toBe("private address");
    expect(await dispatcher.check({ url: "https://hooks.example.test/x", secret: "s".repeat(16) })).toBeNull();
  });

  it("never reaches a real local receiver (SSRF guard)", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const dispatcher = new WebhookDispatcher({ enabled: true, logger, retryDelaysMs: [] });
    dispatcher.deliver({ url: `https://127.0.0.1:${port}/hook`, secret: "s".repeat(16) }, update);
    await sleep(100);
    expect(hits).toBe(0);
    expect(dispatcher.delivered[0].status).toBe("blocked: private address");
    server.close();
  });

  it("signs the body with HMAC-SHA256 and retries with backoff, then gives up", async () => {
    const calls: Array<{ body: string; signature: string; redirect: string }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push({ body: String(init.body), signature: (init.headers as Record<string, string>)[WEBHOOK_SIGNATURE_HEADER], redirect: String(init.redirect) });
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const dispatcher = new WebhookDispatcher({ enabled: true, logger, fetch: fetchImpl, resolve: async () => ["93.184.216.34"], retryDelaysMs: [5, 5, 5] });
    const secret = "test-webhook-secret-0001";
    dispatcher.deliver({ url: "https://hooks.example.test/x", secret }, update);
    await sleep(200);
    expect(calls).toHaveLength(4);
    expect(calls[0].signature).toBe(signWebhook(secret, calls[0].body));
    expect(calls[0].redirect).toBe("manual");
    expect(JSON.parse(calls[0].body).seq).toBe(7);
    const off = new WebhookDispatcher({ enabled: false, logger, fetch: fetchImpl });
    off.deliver({ url: "https://hooks.example.test/x", secret }, update);
    await sleep(20);
    expect(calls).toHaveLength(4);
  });

  it("delivers signed order updates for an agent with a configured webhook when enabled", async () => {
    const received: Array<{ url: string; body: string; signature: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      received.push({ url, body: String(init.body), signature: (init.headers as Record<string, string>)[WEBHOOK_SIGNATURE_HEADER] });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const secret = "agent-hook-secret-000001";
    const base = await orderApp();
    await base.app.close();
    const hooked = { ...base.keys.a.config, webhook: { url: "https://hooks.example.test/brickworks", secret } };
    const { app, runtime } = await orderApp({ webhooksEnabled: true, agentKeys: [hooked], webhookFetch: fetchImpl, webhookResolve: async () => ["93.184.216.34"] });
    try {
      const auth = base.keys.a.auth;
      const quote = (await app.inject({ method: "POST", url: "/api/agent/v1/quotes", headers: auth, payload: quoteBody() })).json();
      await app.inject({ method: "POST", url: "/api/agent/v1/orders", headers: auth, payload: { quoteId: quote.quoteId, leadOption: "standard", idempotencyKey: "hook-key-001" } });
      await sleep(50);
      expect(received.length).toBeGreaterThanOrEqual(2);
      expect(received[0].url).toBe("https://hooks.example.test/brickworks");
      expect(JSON.parse(received[0].body).type).toBe("order.placed");
      for (const r of received) expect(r.signature).toBe(signWebhook(secret, r.body));
      expect(runtime.webhooks?.delivered.every((d) => d.status === 204)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
