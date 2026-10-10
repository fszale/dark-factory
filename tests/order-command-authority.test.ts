import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/server/src/app.ts";
import type { FactorySnapshot } from "../packages/contracts/src/index.ts";

describe("order command authority (DF-ORDER-001 task 3)", () => {
  it("refuses order-agent-create on visitor sessions but allows order-cancel", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { scenario: "balanced" } });
    expect(created.statusCode).toBe(200);
    const session = created.json() as { id: string; token: string; snapshot: FactorySnapshot };
    const headers = { "x-session-token": session.token };
    const denied = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/command`,
      headers,
      payload: { id: "visitor-agent-order", type: "order-agent-create", value: "1:2:spoofed-ref" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: expect.stringContaining("order desk") });
    const order = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/command`,
      headers,
      payload: { id: "visitor-order", type: "order-create", value: "2:3" },
    });
    expect(order.statusCode).toBe(200);
    const created2 = order.json() as { ok: boolean; message: string };
    expect(created2.ok).toBe(true);
    const orderId = created2.message.replace(/^Created /, "");
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/command`,
      headers,
      payload: { id: "visitor-cancel", type: "order-cancel", value: orderId },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ ok: true });
    const current = await app.inject({ method: "GET", url: `/api/sessions/${session.id}`, headers });
    const snapshot = (current.json() as { snapshot: FactorySnapshot }).snapshot;
    expect(snapshot.orders.some((o) => o.id === orderId)).toBe(false);
    expect(snapshot.metrics.ordersCancelled).toBe(1);
    await app.close();
  });
});
