/**
 * DF-ORDER-001 task 18: agent-order scenario runner used by the e2e suite.
 *
 * Loads a `scenarios/agent-orders/*.json` file, builds the app with the order desk on a
 * manual clock (seeded floor, throwaway keys per scenario agent), drives the steps over
 * real MCP (Streamable HTTP, SDK client) or the operator floor route, advances the floor
 * to the expectation, and returns a report listing every unmet expectation.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LINE_IDS, SCENARIOS } from "../../packages/contracts/src/index.ts";
import {
  AGENT_SCOPES,
  ORDER_STATUSES,
  ORDER_TOOL_NAMES,
  ORDER_UPDATE_TYPES,
  type OrderUpdate,
} from "../../packages/contracts/src/orders.ts";
import { FactorySimulation } from "../../packages/simulation/src/index.ts";
import type { AgentKeyConfig } from "../../apps/server/src/order-desk/config.ts";
import { orderApp } from "./order-server.ts";

const toolStep = z
  .object({
    at: z.number().finite().nonnegative(),
    agent: z.string().min(1).max(40),
    tool: z.enum(ORDER_TOOL_NAMES),
    args: z.record(z.unknown()),
  })
  .strict();
const operatorStep = z
  .object({
    at: z.number().finite().nonnegative(),
    operator: z
      .object({
        type: z.enum(["fault", "repair", "pause", "start", "speed", "order-create", "order-priority"]),
        value: z.union([z.string(), z.number()]).optional(),
        station: z.enum(LINE_IDS).optional(),
      })
      .strict(),
  })
  .strict();
export const agentOrderScenarioSchema = z
  .object({
    kind: z.literal("brickworks-agent-order-scenario"),
    version: z.literal(1),
    description: z.string().max(400).optional(),
    floor: z.object({ scenario: z.enum(SCENARIOS), seed: z.number().int().nonnegative() }).strict(),
    agents: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,40}$/),
            label: z.string().max(80).optional(),
            scopes: z.array(z.enum(AGENT_SCOPES)).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    steps: z.array(z.union([toolStep, operatorStep])).min(1).max(50),
    expect: z
      .object({
        /** Which order the expectations apply to; defaults to the first place_order result. */
        order: z.string().optional(),
        finalStatus: z.enum(ORDER_STATUSES),
        maxSimSeconds: z.number().finite().positive().max(7200),
        statusSubsequence: z.array(z.enum(ORDER_STATUSES)).default([]),
        updateTypes: z.array(z.enum(ORDER_UPDATE_TYPES)).default([]),
        shipMatchesQuote: z.boolean().default(false),
        engine: z.object({ ordersCancelledAtLeast: z.number().int().nonnegative().optional() }).strict().optional(),
        ledgerIntact: z.boolean().default(false),
      })
      .strict(),
  })
  .strict()
  .refine((s) => [...s.steps].every((step, i, all) => i === 0 || step.at >= all[i - 1].at), "steps must be ordered by `at`")
  .refine((s) => s.steps.every((step) => !("agent" in step) || s.agents.some((a) => a.id === step.agent)), "every step agent must be declared");
export type AgentOrderScenario = z.infer<typeof agentOrderScenarioSchema>;

export function loadAgentOrderScenario(path: string): AgentOrderScenario {
  return agentOrderScenarioSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const REF = /^\$steps\[(\d+)\]\.([A-Za-z0-9_.]+)$/;
function resolveRefs(value: unknown, results: unknown[]): unknown {
  if (typeof value === "string") {
    const match = REF.exec(value);
    if (!match) return value;
    let current: unknown = results[Number(match[1])];
    for (const key of match[2].split(".")) current = (current as Record<string, unknown> | undefined)?.[key];
    if (current === undefined) throw new Error(`Unresolved reference ${value}`);
    return current;
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, results));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, results)]));
  return value;
}

/** Subsequence match on de-duplicated simulated statuses. */
function hasSubsequence(statuses: string[], expected: string[]) {
  let k = 0;
  for (const status of statuses) if (status === expected[k]) k++;
  return k === expected.length;
}

function conservationDeltas(sim: FactorySimulation) {
  const s = sim.snapshot();
  const material =
    s.metrics.initial +
    s.metrics.received -
    (s.metrics.consumed +
      Object.values(s.warehouse).reduce((a, b) => a + b, 0) +
      Object.values(s.stations).reduce((a, b) => a + b.stock, 0) +
      s.carts.reduce((a, b) => a + b.amount, 0));
  const ledger = s.orders.reduce((total, o) => total + o.quantity - o.completed, 0) - (s.metrics.orderedUnits - s.metrics.completed);
  return { material, ledger };
}

export interface ScenarioReport {
  name: string;
  orderId: string | null;
  finalStatus: string | null;
  simTime: number;
  statuses: string[];
  updateTypes: string[];
  quotedShipBySimTime: number | null;
  actualShipSimTime: number | null;
  ordersCancelled: number;
  conservation: { material: number; ledger: number };
  failures: string[];
}

type ToolResult = { structuredContent?: Record<string, unknown>; isError?: boolean; content?: unknown };

export async function runAgentOrderScenario(path: string): Promise<ScenarioReport> {
  const scenario = loadAgentOrderScenario(path);
  const keys = new Map<string, { key: string; config: AgentKeyConfig }>();
  for (const agent of scenario.agents) {
    const key = `bwk_scn_${randomBytes(24).toString("base64url")}`;
    keys.set(agent.id, {
      key,
      config: { id: agent.id, label: agent.label ?? agent.id, sha256: createHash("sha256").update(key).digest("hex"), scopes: agent.scopes, maxActiveOrders: 3, webhook: null },
    });
  }
  const { app, runtime, advance } = await orderApp({
    seed: scenario.floor.seed,
    scenario: scenario.floor.scenario,
    agentKeys: [...keys.values()].map((k) => k.config),
  });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const clients = new Map<string, Client>();
  const failures: string[] = [];
  const results: unknown[] = [];
  const now = () => runtime.floor().sim.snapshot().time;
  const advanceTo = async (time: number) => {
    while (now() < time - 1e-9) {
      advance(Math.min(20, time - now()));
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  try {
    for (const agent of scenario.agents) {
      const client = new Client({ name: `scenario-${agent.id}`, version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${keys.get(agent.id)!.key}` } } }));
      clients.set(agent.id, client);
    }
    for (const [index, step] of scenario.steps.entries()) {
      await advanceTo(step.at);
      if ("tool" in step) {
        const result = (await clients.get(step.agent)!.callTool({ name: step.tool, arguments: resolveRefs(step.args, results) as Record<string, unknown> })) as ToolResult;
        if (result.isError) failures.push(`step ${index} ${step.tool} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`);
        results.push(result.structuredContent ?? null);
      } else {
        const response = await app.inject({ method: "POST", url: "/api/order-floor/command", payload: { command: { id: `scenario-${index}`, ...step.operator } } });
        const body = response.json() as { ok?: boolean; message?: string };
        if (response.statusCode !== 200 || !body.ok) failures.push(`step ${index} operator ${step.operator.type} refused: ${body.message ?? response.statusCode}`);
        results.push(body);
      }
    }
    const placeIndex = scenario.steps.findIndex((s) => "tool" in s && s.tool === "place_order");
    const orderId = (scenario.expect.order ? resolveRefs(scenario.expect.order, results) : (results[placeIndex] as { order?: { orderId?: string } } | undefined)?.order?.orderId) as string | undefined;
    const owner = placeIndex >= 0 ? (scenario.steps[placeIndex] as z.infer<typeof toolStep>).agent : scenario.agents[0].id;
    const ownerClient = clients.get(owner)!;
    const statusOf = async () => {
      const result = (await ownerClient.callTool({ name: "get_order", arguments: { orderId } })) as ToolResult;
      return (result.structuredContent as { order?: { status?: string } } | undefined)?.order?.status ?? null;
    };
    let finalStatus: string | null = null;
    if (orderId) {
      finalStatus = await statusOf();
      while (finalStatus !== scenario.expect.finalStatus && now() < scenario.expect.maxSimSeconds) {
        await advanceTo(Math.min(scenario.expect.maxSimSeconds, now() + 20));
        finalStatus = await statusOf();
      }
    } else failures.push("no order id to follow");
    const updates: OrderUpdate[] = [];
    if (orderId) {
      let cursor: string | undefined;
      for (;;) {
        const page = (await ownerClient.callTool({ name: "get_order_updates", arguments: { orderId, limit: 100, ...(cursor ? { cursor } : {}) } })) as ToolResult;
        const body = page.structuredContent as { updates: OrderUpdate[]; nextCursor: string; hasMore: boolean };
        updates.push(...body.updates);
        cursor = body.nextCursor;
        if (!body.hasMore) break;
      }
    }
    const statuses = updates.filter((u) => u.source === "simulated").map((u) => u.status).filter((s, i, list) => s !== list[i - 1]);
    const types = [...new Set(updates.map((u) => u.type))];
    if (finalStatus !== scenario.expect.finalStatus) failures.push(`final status ${finalStatus}, expected ${scenario.expect.finalStatus} by sim ${scenario.expect.maxSimSeconds}s`);
    if (!hasSubsequence(statuses, scenario.expect.statusSubsequence)) failures.push(`statuses ${statuses.join(",")} lack subsequence ${scenario.expect.statusSubsequence.join(",")}`);
    for (const type of scenario.expect.updateTypes) if (!types.includes(type)) failures.push(`missing update type ${type}`);
    let quotedShip: number | null = null;
    const actualShip = updates.find((u) => u.type === "unit.shipped")?.simTime ?? null;
    if (placeIndex >= 0) {
      const place = scenario.steps[placeIndex] as z.infer<typeof toolStep>;
      const quoteId = resolveRefs(place.args.quoteId, results);
      const quote = results.find((r) => (r as { quoteId?: string } | null)?.quoteId === quoteId) as { leadOptions?: Array<{ name: string; shipBySimTime: number | null }> } | undefined;
      quotedShip = quote?.leadOptions?.find((o) => o.name === place.args.leadOption)?.shipBySimTime ?? null;
    }
    if (scenario.expect.shipMatchesQuote && (quotedShip === null || actualShip === null || Math.abs(quotedShip - actualShip) > 1e-6))
      failures.push(`ship time ${actualShip} does not equal quoted ${quotedShip}`);
    const sim = runtime.floor().sim;
    const ordersCancelled = sim.snapshot().metrics.ordersCancelled ?? 0;
    const minCancelled = scenario.expect.engine?.ordersCancelledAtLeast;
    if (minCancelled !== undefined && ordersCancelled < minCancelled) failures.push(`engine ordersCancelled ${ordersCancelled} < ${minCancelled}`);
    const conservation = conservationDeltas(sim);
    if (scenario.expect.ledgerIntact) {
      if (conservation.material !== 0 || conservation.ledger !== 0) failures.push(`conservation deltas ${JSON.stringify(conservation)}`);
      try {
        FactorySimulation.fromExport(sim.exportRun());
      } catch (error) {
        failures.push(`checkpoint ledger validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      name: path.split("/").pop()!,
      orderId: orderId ?? null,
      finalStatus,
      simTime: now(),
      statuses,
      updateTypes: types,
      quotedShipBySimTime: quotedShip,
      actualShipSimTime: actualShip,
      ordersCancelled,
      conservation,
      failures,
    };
  } finally {
    for (const client of clients.values()) await client.close().catch(() => undefined);
    await app.close();
  }
}
