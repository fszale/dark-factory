import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { ORDER_TOOL_NAMES, orderView, quoteVehicleOutput, type OrderUpdate } from "../packages/contracts/src/orders.ts";
import { readFileSync } from "node:fs";
import { agentOrderScenarioSchema, runAgentOrderScenario } from "./helpers/agent-order-scenario.ts";
import { rebuildFromFloorArchive } from "./helpers/floor-archive.ts";
import { orderApp } from "./helpers/order-server.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url: string, key?: string) {
  const client = new Client({ name: "brickworks-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: key ? { headers: { Authorization: `Bearer ${key}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

type ToolResult = { structuredContent?: Record<string, unknown>; isError?: boolean };

describe("DF-ORDER-001 MCP end to end (task 12)", () => {
  it("orders one robotaxi over MCP on seed 42 balanced and observes every status through delivered", async () => {
    const { app, keys, runtime, dataDir, advance } = await orderApp({ seed: 42, scenario: "balanced" });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = await connect(url, keys.a.key);
    const other = await connect(url, keys.b.key);
    const anonymous = await connect(url);
    try {
      // 1. Exactly the eight tools, each with input and output schemas.
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([...ORDER_TOOL_NAMES].sort());
      for (const tool of tools.tools) {
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.outputSchema?.type).toBe("object");
      }
      // 2. Catalog and capabilities, also anonymously; anonymous quote is refused.
      const catalog = (await anonymous.callTool({ name: "list_vehicle_configs", arguments: {} })) as ToolResult;
      expect(catalog.structuredContent?.virtual).toBe(true);
      const caps = (await client.callTool({ name: "get_capabilities", arguments: {} })) as ToolResult;
      expect((caps.structuredContent as { transports: { mcp: string } }).transports.mcp).toBe(`${url}/mcp`);
      const anonQuote = (await anonymous.callTool({ name: "quote_vehicle", arguments: { config: { modelId: "robotaxi-gold-two-seat" }, quantity: 1, destinationZone: "zone-local" } })) as ToolResult;
      expect(anonQuote.isError).toBe(true);
      expect((anonQuote.structuredContent as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
      // Schema rejects payment-like fields before the desk sees them.
      const smuggled = (await client.callTool({ name: "place_order", arguments: { quoteId: "aq-0000000000", leadOption: "standard", idempotencyKey: "smuggle-01", payment: { card: "1" } } })) as ToolResult;
      expect(smuggled.isError).toBe(true);
      // 3. Quote with progress notifications.
      const progress: number[] = [];
      const quoted = (await client.callTool(
        { name: "quote_vehicle", arguments: { config: { modelId: "robotaxi-gold-two-seat", options: { finish: "gold" } }, quantity: 1, destinationZone: "zone-local", leadOptions: ["standard", "expedite"] } },
        undefined,
        { onprogress: (p) => progress.push(p.progress) },
      )) as ToolResult;
      const quote = quoteVehicleOutput.parse(quoted.structuredContent);
      expect(quote.feasibility.manufacturable).toBe(true);
      expect(progress.at(-1)).toBe(1);
      const expedite = quote.leadOptions.find((o) => o.name === "expedite")!;
      expect(expedite.shipBySimTime).not.toBeNull();
      expect(JSON.stringify(quote)).not.toMatch(/"seed"/);
      // 4. Place, then replay with the same key.
      const args = { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "e2e-order-0001" };
      const placed = (await client.callTool({ name: "place_order", arguments: args })) as ToolResult;
      const order = orderView.parse((placed.structuredContent as { order: unknown }).order);
      const replay = (await client.callTool({ name: "place_order", arguments: args })) as ToolResult;
      expect(replay.structuredContent).toMatchObject({ replayed: true, order: { orderId: order.orderId } });
      // 5. Subscribe to the order resource.
      const notified: string[] = [];
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
        notified.push(n.params.uri);
      });
      await client.subscribeResource({ uri: `brickworks://orders/${order.orderId}` });
      await expect(other.subscribeResource({ uri: `brickworks://orders/${order.orderId}` })).rejects.toThrow();
      const listed = await client.listResources();
      expect(listed.resources.map((r) => r.uri)).toContain(`brickworks://orders/${order.orderId}`);
      // 6. Advance the manual clock until delivered (bounded).
      let status = order.status;
      for (let t = 0; t < 3600 && status !== "delivered"; t += 20) {
        advance(20);
        if (t % 200 === 0) await sleep(5);
        status = runtime.floor().desk.getOrder({ id: "test-agent", label: "", scopes: [], maxActiveOrders: 3 }, order.orderId).status;
      }
      expect(status).toBe("delivered");
      await sleep(1300);
      expect(notified.length).toBeGreaterThan(0);
      expect(new Set(notified)).toEqual(new Set([`brickworks://orders/${order.orderId}`]));
      // 7. Status subsequence and factory event links.
      const updates: OrderUpdate[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = (await client.callTool({ name: "get_order_updates", arguments: { orderId: order.orderId, limit: 100, ...(cursor ? { cursor } : {}) } })) as ToolResult;
        const body = page.structuredContent as { updates: OrderUpdate[]; nextCursor: string; hasMore: boolean };
        updates.push(...body.updates);
        cursor = body.nextCursor;
        if (!body.hasMore) break;
      }
      const statuses = updates.map((u) => u.status).filter((s, i, list) => s !== list[i - 1]);
      const expected = ["placed", "accepted", "scheduled", "in_production", "quality_check", "completed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery", "delivered"];
      let k = 0;
      for (const s of statuses) if (s === expected[k]) k++;
      expect(k, `statuses ${statuses.join(",")}`).toBe(expected.length);
      const events = new Map(runtime.floor().sim.snapshot().events.map((e) => [e.id, e.type]));
      const { items } = rebuildFromFloorArchive(dataDir, runtime.floor().sim.snapshot().time);
      for (const item of items) if (item.kind === "event") events.set(item.event.id, item.event.type);
      const linked = updates.filter((u) => u.factoryEvent);
      expect(linked.length).toBeGreaterThan(5);
      for (const u of linked) expect(events.get(u.factoryEvent!.id), u.type).toBe(u.factoryEvent!.type);
      // 8. Actual ship time equals the quoted shipBySimTime.
      const shipped = updates.find((u) => u.type === "unit.shipped")!;
      expect(shipped.simTime).toBeCloseTo(expedite.shipBySimTime!, 6);
      // 9. Another agent cannot read it.
      const peek = (await other.callTool({ name: "get_order", arguments: { orderId: order.orderId } })) as ToolResult;
      expect(peek.isError).toBe(true);
      expect((peek.structuredContent as { error: { code: string } }).error.code).toBe("ORDER_NOT_FOUND");
      // 10. Rebuild the desk from the floor archive; the simulated update log hash matches.
      advance(0);
      const rebuilt = rebuildFromFloorArchive(dataDir, runtime.floor().sim.snapshot().time);
      expect(rebuilt.desk.updateLogDigest()).toBe(runtime.floor().desk.updateLogDigest());
    } finally {
      await client.close().catch(() => undefined);
      await other.close().catch(() => undefined);
      await anonymous.close().catch(() => undefined);
      await app.close();
    }
  }, 120_000);
});

describe("DF-ORDER-001 agent-order scenarios over MCP (task 18)", () => {
  const file = (name: string) => new URL(`../scenarios/agent-orders/${name}`, import.meta.url).pathname;

  it("standard-delivery: delivered with ship time equal to the quote", async () => {
    const report = await runAgentOrderScenario(file("standard-delivery.json"));
    expect(report.failures, JSON.stringify(report)).toEqual([]);
    expect(report.actualShipSimTime).toBe(report.quotedShipBySimTime);
  }, 120_000);

  it("assembly-outage-delay: at risk, estimate revised, risk cleared after repair, delivered", async () => {
    const report = await runAgentOrderScenario(file("assembly-outage-delay.json"));
    expect(report.failures, JSON.stringify(report)).toEqual([]);
    const types = report.updateTypes;
    expect(types.indexOf("order.at_risk")).toBeLessThan(types.indexOf("order.risk_cleared"));
    expect(report.finalStatus).toBe("delivered");
  }, 120_000);

  it("cancel-before-commit: cancelled while scheduled, engine counts it, ledger intact", async () => {
    const report = await runAgentOrderScenario(file("cancel-before-commit.json"));
    expect(report.failures, JSON.stringify(report)).toEqual([]);
    expect(report.ordersCancelled).toBeGreaterThanOrEqual(1);
    expect(report.conservation).toEqual({ material: 0, ledger: 0 });
  }, 120_000);

  it("rejects malformed scenario files", () => {
    expect(() => agentOrderScenarioSchema.parse({ kind: "brickworks-agent-order-scenario", version: 1, floor: { scenario: "balanced", seed: 42 }, agents: [], steps: [], expect: {} })).toThrow();
    const base = JSON.parse(readFileSync(file("standard-delivery.json"), "utf8"));
    expect(() => agentOrderScenarioSchema.parse({ ...base, steps: [{ ...base.steps[0], agent: "ghost" }] })).toThrow();
    expect(() => agentOrderScenarioSchema.parse({ ...base, payment: { card: "1" } })).toThrow();
  });
});
