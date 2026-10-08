import type { ZodTypeAny } from "zod";
import { LINE_IDS, LINE_META } from "../../../../packages/contracts/src/index.ts";
import { ROBOTAXI_RECIPE } from "../../../../packages/assets/src/design.ts";
import {
  cancelOrderInput,
  cancelOrderOutput,
  FLOOR_ID,
  getCapabilitiesInput,
  getCapabilitiesOutput,
  getOrderInput,
  getOrderOutput,
  getOrderUpdatesInput,
  getOrderUpdatesOutput,
  listOrdersInput,
  listOrdersOutput,
  listVehicleConfigsInput,
  listVehicleConfigsOutput,
  ORDER_TOOL_SCOPES,
  ORDER_TOOL_SUMMARIES,
  placeOrderInput,
  placeOrderOutput,
  quoteVehicleInput,
  quoteVehicleOutput,
  VIRTUAL_DISCLAIMER,
  type AgentScope,
  type GetCapabilitiesOutput,
  type GetOrderUpdatesOutput,
  type OrderToolName,
  type OrderUpdate,
} from "../../../../packages/contracts/src/orders.ts";
import { listVehicleConfigs } from "../../../../packages/orders/src/catalog.ts";
import { zoneList } from "../../../../packages/orders/src/carrier.ts";
import { OrderDesk, OrderDeskError } from "../../../../packages/orders/src/desk.ts";
import { ORDER_MAX_QUANTITY } from "../../../../packages/orders/src/feasibility.ts";
import { LEAD_OPTION_PRIORITY } from "../../../../packages/orders/src/pricing.ts";
import { requireScope, type Agent, type LimitedCall, type RateLimiter } from "./auth.ts";
import type { OrderDeskConfig } from "./config.ts";
import type { OrderFloor } from "./floor.ts";

export interface CallContext {
  agent: Agent | null;
  ip: string;
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
  /** Origin used for transport URLs when PUBLIC_BASE_URL is unset (local runs only). */
  requestOrigin?: string;
}

export interface ToolDefinition {
  name: OrderToolName;
  title: string;
  description: string;
  input: ZodTypeAny;
  output: ZodTypeAny;
  readOnly: boolean;
  idempotent: boolean;
}

const TITLES: Record<OrderToolName, string> = {
  list_vehicle_configs: "List vehicle configurations",
  get_capabilities: "Get factory capabilities",
  quote_vehicle: "Quote a virtual vehicle order",
  place_order: "Place a virtual order",
  get_order: "Get an order",
  list_orders: "List my orders",
  cancel_order: "Cancel an order",
  get_order_updates: "Get order updates",
};

/** The single tool registry used by MCP, REST, OpenAPI and the discovery documents. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: "list_vehicle_configs", input: listVehicleConfigsInput, output: listVehicleConfigsOutput, readOnly: true, idempotent: true },
  { name: "get_capabilities", input: getCapabilitiesInput, output: getCapabilitiesOutput, readOnly: true, idempotent: true },
  { name: "quote_vehicle", input: quoteVehicleInput, output: quoteVehicleOutput, readOnly: true, idempotent: false },
  { name: "place_order", input: placeOrderInput, output: placeOrderOutput, readOnly: false, idempotent: true },
  { name: "get_order", input: getOrderInput, output: getOrderOutput, readOnly: true, idempotent: true },
  { name: "list_orders", input: listOrdersInput, output: listOrdersOutput, readOnly: true, idempotent: true },
  { name: "cancel_order", input: cancelOrderInput, output: cancelOrderOutput, readOnly: false, idempotent: true },
  { name: "get_order_updates", input: getOrderUpdatesInput, output: getOrderUpdatesOutput, readOnly: true, idempotent: true },
].map((tool) => ({
  ...tool,
  name: tool.name as OrderToolName,
  title: TITLES[tool.name as OrderToolName],
  description: `${ORDER_TOOL_SUMMARIES[tool.name as OrderToolName]} Virtual only: no payment, no physical vehicle, no shipment.`,
}));

const limitedCall = (name: OrderToolName): LimitedCall =>
  name === "quote_vehicle" || name === "place_order" ? name : "other";

export interface ServiceRuntime {
  config: OrderDeskConfig;
  limiter: RateLimiter;
  floor: () => OrderFloor;
  /** True while the env flag is on and the runtime kill switch has not been thrown. */
  active: () => boolean;
}

export const CLOCK_NOTE =
  "All times are simulated seconds on the shared order floor clock unless labeled as wall time. If the operator pauses the floor, simulated time and the virtual carrier stop with it; wall-clock ETAs are estimates that shift with floor speed.";

export class OrderDeskService {
  constructor(private readonly runtime: ServiceRuntime) {}

  private desk(): OrderDesk {
    if (!this.runtime.active()) throw new OrderDeskError("ORDER_DESK_DISABLED", "The order desk is disabled.", true);
    return this.runtime.floor().desk;
  }

  transportUrls(ctx: CallContext) {
    const base = this.runtime.config.publicBaseUrl ?? ctx.requestOrigin ?? "http://localhost:3000";
    return { mcp: `${base}/mcp`, rest: `${base}/api/agent/v1`, openapi: `${base}/api/agent/v1/openapi.json` };
  }

  capabilities(ctx: CallContext): GetCapabilitiesOutput {
    const desk = this.desk();
    const snapshot = this.runtime.floor().sim.snapshot();
    const limits = this.runtime.config.rateLimits;
    return {
      factory: {
        name: "Brickworks dark factory (virtual)",
        floorId: FLOOR_ID,
        lines: LINE_IDS.map((id) => ({ id, name: LINE_META[id].name, nominalCycleSeconds: LINE_META[id].cycle })),
        recipe: { id: ROBOTAXI_RECIPE.id, joiningOrder: [...ROBOTAXI_RECIPE.joiningOrder], inspection: [...ROBOTAXI_RECIPE.inspection] },
        parkingBays: snapshot.config.parkingCapacity,
        destinationZones: zoneList().map((zone) => ({ id: zone.id, nominalTransitSeconds: zone.nominalTransitSeconds * this.runtime.config.deliveryTimeScale })),
        leadOptions: (Object.keys(LEAD_OPTION_PRIORITY) as Array<keyof typeof LEAD_OPTION_PRIORITY>).map((name) => ({ name, productionPriority: LEAD_OPTION_PRIORITY[name] })),
        clockNote: CLOCK_NOTE,
      },
      floorStatus: desk.floorStatus(),
      limits: {
        maxQuantityPerOrder: ORDER_MAX_QUANTITY,
        maxActiveOrdersPerAgent: ctx.agent?.maxActiveOrders ?? 3,
        maxActiveAgentOrdersOnFloor: 10,
        quoteTtlSeconds: Math.round(this.runtime.config.quoteTtlMs / 1000),
        rateLimits: {
          anyCallPerAgent: `${limits.perAgentPerMinute}/min`,
          quoteVehicle: `${limits.quotePerMinute}/min`,
          placeOrder: `${limits.placePerMinute}/min, ${limits.placePerDay}/day`,
          concurrentStreams: String(limits.concurrentStreams),
          anonymousPerIp: `${limits.anonymousPerMinute}/min`,
        },
      },
      transports: this.transportUrls(ctx),
      virtual: true,
      disclaimer: VIRTUAL_DISCLAIMER,
    };
  }

  /** Same authorization rule as call(), for non-tool endpoints such as the SSE stream. */
  ensureScope(agent: Agent | null, scope: AgentScope | null) {
    this.desk();
    if (!agent && (scope !== null || !this.runtime.config.anonRead))
      throw new OrderDeskError("UNAUTHORIZED", "A bearer agent key is required for this call.");
    requireScope(agent, scope);
  }

  /** Validates input with the tool's strict schema, authorizes, rate limits, then runs the call. */
  async call(name: OrderToolName, raw: unknown, ctx: CallContext): Promise<unknown> {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
    if (!tool) throw new OrderDeskError("VALIDATION_FAILED", `Unknown tool ${name}.`);
    this.ensureScope(ctx.agent, ORDER_TOOL_SCOPES[name]);
    this.runtime.limiter.check(ctx.agent, ctx.ip, limitedCall(name));
    const parsed = tool.input.safeParse(raw ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new OrderDeskError("VALIDATION_FAILED", `Invalid input${first ? ` at ${first.path.join(".") || "(root)"}: ${first.message}` : "."}`.slice(0, 300));
    }
    const input = parsed.data;
    const agent = ctx.agent!;
    const desk = this.desk();
    switch (name) {
      case "list_vehicle_configs":
        return listVehicleConfigs();
      case "get_capabilities":
        return this.capabilities(ctx);
      case "quote_vehicle":
        return desk.quote(agent, input, ctx.onProgress);
      case "place_order":
        return desk.placeOrder(agent, input);
      case "get_order":
        return { order: desk.getOrder(agent, input.orderId) };
      case "list_orders":
        return desk.listOrders(agent, input);
      case "cancel_order":
        return desk.cancelOrder(agent, input);
      case "get_order_updates":
        return this.updates(agent, input, ctx);
    }
  }

  /** get_order_updates with an optional long poll that returns as soon as one of the caller's updates lands. */
  private async updates(agent: Agent, input: { orderId?: string; cursor?: string; limit: number; waitSeconds: number }, ctx: CallContext): Promise<GetOrderUpdatesOutput> {
    const desk = this.desk();
    const first = desk.updatesFor(agent, input);
    if (first.updates.length || input.waitSeconds <= 0) return first;
    const release = this.runtime.limiter.openStream(agent);
    try {
      const after = OrderDesk.parseCursor(input.cursor);
      await this.waitForUpdate(agent, after, input.orderId, input.waitSeconds * 1000, ctx.signal);
      return this.desk().updatesFor(agent, input);
    } finally {
      release();
    }
  }

  /** Resolves when the agent has an update after `after`, on timeout, or on abort. */
  waitForUpdate(agent: Agent, after: number, orderId: string | undefined, timeoutMs: number, signal?: AbortSignal) {
    const floor = this.runtime.floor();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsubscribe = floor.onUpdate((update: OrderUpdate) => {
        if (update.seq <= after) return;
        if (orderId ? update.orderId === orderId : floor.desk.ownsOrder(agent.id, update.orderId)) finish();
      });
      signal?.addEventListener("abort", finish);
      if (floor.desk.hasUpdatesAfter(agent, after, orderId)) finish();
    });
  }
}
