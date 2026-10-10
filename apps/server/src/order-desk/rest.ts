import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { orderDeskError, VIRTUAL_DISCLAIMER, withVirtualNotice, type OrderToolName, type OrderUpdate } from "../../../../packages/contracts/src/orders.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";
import type { Agent } from "./auth.ts";
import { agentRouteErrorHandler, clientIp, requestOrigin, sendDeskError } from "./http.ts";
import { TOOL_DEFINITIONS, type OrderDeskService } from "./service.ts";
import type { OrderDeskRuntime } from "./runtime.ts";

export const REST_BASE = "/api/agent/v1";
export const AGENT_BODY_LIMIT = 64 * 1024;
const SSE_KEEPALIVE_MS = 25_000;

/** REST routes and the tool each one mirrors. */
export const REST_ROUTES: Array<{ method: "GET" | "POST"; path: string; tool: OrderToolName | null; summary: string }> = [
  { method: "GET", path: "/catalog", tool: "list_vehicle_configs", summary: "list_vehicle_configs" },
  { method: "GET", path: "/capabilities", tool: "get_capabilities", summary: "get_capabilities" },
  { method: "POST", path: "/quotes", tool: "quote_vehicle", summary: "quote_vehicle" },
  { method: "POST", path: "/orders", tool: "place_order", summary: "place_order (Idempotency-Key header or body field)" },
  { method: "GET", path: "/orders", tool: "list_orders", summary: "list_orders (?status=a,b&cursor=&limit=)" },
  { method: "GET", path: "/orders/{orderId}", tool: "get_order", summary: "get_order" },
  { method: "POST", path: "/orders/{orderId}/cancel", tool: "cancel_order", summary: "cancel_order (Idempotency-Key header or body field)" },
  { method: "GET", path: "/updates", tool: "get_order_updates", summary: "get_order_updates (?orderId=&cursor=&limit=&wait=)" },
  { method: "GET", path: "/orders/{orderId}/events", tool: null, summary: "Server-sent events stream of orderUpdate, resumable with Last-Event-ID = seq" },
];

const asInt = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);

export function openApiDocument(baseUrl: string) {
  const json = (schema: Parameters<typeof zodToJsonSchema>[0]) => zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of REST_ROUTES) {
    const tool = route.tool ? TOOL_DEFINITIONS.find((t) => t.name === route.tool)! : null;
    const operation: Record<string, unknown> = {
      operationId: route.tool ?? "stream_order_events",
      summary: route.summary,
      description: tool?.description ?? "Server-sent events. Each event id is the update seq; reconnect with Last-Event-ID to resume.",
      security: tool && tool.name !== "list_vehicle_configs" && tool.name !== "get_capabilities" ? [{ bearer: [] }] : tool ? [{}, { bearer: [] }] : [{ bearer: [] }],
      responses: {
        "200": tool
          ? { description: "OK", content: { "application/json": { schema: json(tool.output) } } }
          : { description: "Event stream", content: { "text/event-stream": { schema: { type: "string" } } } },
        default: { description: "orderDeskError", content: { "application/json": { schema: json(orderDeskError) } } },
      },
    };
    if (route.path.includes("{orderId}"))
      operation.parameters = [{ name: "orderId", in: "path", required: true, schema: { type: "string", pattern: "^ao-[0-9a-z]{10}$" } }];
    if (route.method === "POST" && tool) operation.requestBody = { required: true, content: { "application/json": { schema: json(tool.input) } } };
    paths[`${REST_BASE}${route.path}`] = { ...(paths[`${REST_BASE}${route.path}`] ?? {}), [route.method.toLowerCase()]: operation };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Brickworks order desk (virtual)",
      version: "1.0.0",
      description: `REST mirror of the Brickworks order desk MCP tools. ${VIRTUAL_DISCLAIMER}`,
    },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    paths,
  };
}

export function registerRest(app: FastifyInstance, runtime: OrderDeskRuntime, service: OrderDeskService) {
  const context = (request: FastifyRequest, agent: Agent | null, signal?: AbortSignal) => ({
    agent,
    ip: clientIp(request),
    requestOrigin: requestOrigin(request),
    signal,
  });

  const handle = (tool: OrderToolName, input: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agent = runtime.authenticate(request);
      const abort = new AbortController();
      request.raw.on("close", () => abort.abort());
      const result = await service.call(tool, input(request), context(request, agent, abort.signal));
      reply.header("Cache-Control", "no-store");
      return reply.send(result);
    } catch (error) {
      return sendDeskError(reply, error);
    }
  };
  const body = (request: FastifyRequest) => (request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {});
  const idempotent = (request: FastifyRequest) => {
    const header = request.headers["idempotency-key"];
    const value = Array.isArray(header) ? header[0] : header;
    return value ? { ...body(request), idempotencyKey: value } : body(request);
  };
  const query = (request: FastifyRequest) => (request.query ?? {}) as Record<string, string>;
  const options = { bodyLimit: AGENT_BODY_LIMIT, errorHandler: agentRouteErrorHandler };

  app.get(`${REST_BASE}/catalog`, options, handle("list_vehicle_configs", () => ({})));
  app.get(`${REST_BASE}/capabilities`, options, handle("get_capabilities", () => ({})));
  app.post(`${REST_BASE}/quotes`, options, handle("quote_vehicle", body));
  app.post(`${REST_BASE}/orders`, options, handle("place_order", idempotent));
  app.get(
    `${REST_BASE}/orders`,
    options,
    handle("list_orders", (request) => {
      const q = query(request);
      return {
        ...(q.status ? { status: q.status.split(",").filter(Boolean) } : {}),
        ...(q.cursor ? { cursor: q.cursor } : {}),
        ...(q.limit ? { limit: asInt(q.limit) } : {}),
      };
    }),
  );
  app.get(`${REST_BASE}/orders/:orderId`, options, handle("get_order", (request) => ({ orderId: (request.params as { orderId: string }).orderId })));
  app.post(
    `${REST_BASE}/orders/:orderId/cancel`,
    options,
    handle("cancel_order", (request) => ({ ...idempotent(request), orderId: (request.params as { orderId: string }).orderId })),
  );
  app.get(
    `${REST_BASE}/updates`,
    options,
    handle("get_order_updates", (request) => {
      const q = query(request);
      return {
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.cursor ? { cursor: q.cursor } : {}),
        ...(q.limit ? { limit: asInt(q.limit) } : {}),
        ...(q.wait ? { waitSeconds: asInt(q.wait) } : {}),
      };
    }),
  );
  app.get(`${REST_BASE}/openapi.json`, options, async (request, reply) => {
    if (!runtime.active()) return sendDeskError(reply, new OrderDeskError("ORDER_DESK_DISABLED", "The order desk is disabled.", true));
    reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "public, max-age=300");
    return openApiDocument(`${runtime.config.publicBaseUrl ?? requestOrigin(request) ?? "http://localhost:3000"}`);
  });

  /** SSE: replays retained updates after Last-Event-ID, then streams live ones. */
  app.get(`${REST_BASE}/orders/:orderId/events`, options, async (request, reply) => {
    let release: (() => void) | null = null;
    try {
      const agent = runtime.authenticate(request);
      const orderId = (request.params as { orderId: string }).orderId;
      try {
        service.ensureScope(agent, "order:read");
      } catch (error) {
        throw error instanceof OrderDeskError && error.code !== "ORDER_DESK_DISABLED" ? runtime.limiter.rejected(clientIp(request), error) : error;
      }
      runtime.limiter.admit(agent, clientIp(request));
      const desk = runtime.floor().desk;
      desk.getOrder(agent!, orderId);
      const header = request.headers["last-event-id"];
      const last = Array.isArray(header) ? header[0] : header;
      let after = last && /^\d+$/.test(last) ? Number(last) : 0;
      const backlog = desk.updatesFor(agent!, { orderId, cursor: `u${after}`, limit: 100 });
      release = runtime.limiter.openStream(agent!);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (update: OrderUpdate) => {
        if (update.seq <= after) return;
        after = update.seq;
        res.write(`id: ${update.seq}\nevent: order-update\ndata: ${JSON.stringify(withVirtualNotice(update))}\n\n`);
      };
      res.write(": brickworks order desk stream (virtual)\n\n");
      for (const update of backlog.updates) send(update);
      // Anything past the first page is fetched in order before going live.
      for (let page = backlog; page.hasMore; ) {
        page = runtime.floor().desk.updatesFor(agent!, { orderId, cursor: `u${after}`, limit: 100 });
        for (const update of page.updates) send(update);
      }
      const unsubscribe = runtime.floor().onUpdate((update) => {
        if (update.orderId === orderId) send(update);
      });
      const keepalive = setInterval(() => res.write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
      keepalive.unref();
      const stopStream = runtime.onDisable(() => res.end());
      const finish = () => {
        clearInterval(keepalive);
        unsubscribe();
        stopStream();
        release?.();
        release = null;
      };
      res.on("close", finish);
      request.raw.on("close", finish);
    } catch (error) {
      release?.();
      if (!reply.sent && !reply.raw.headersSent) return sendDeskError(reply, error);
    }
  });

  // Any other path under the agent base is a JSON 404, never the SPA.
  app.all(`${REST_BASE}/*`, options, async (_request, reply) => sendDeskError(reply, new OrderDeskError("ORDER_NOT_FOUND", "No such order desk route.")));
}

