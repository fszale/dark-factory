import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  isInitializeRequest,
  McpError,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { TERMINAL_ORDER_STATUSES, withVirtualNotice, type OrderToolName } from "../../../../packages/contracts/src/orders.ts";
import type { Agent } from "./auth.ts";
import { ORDERING_GUIDE } from "./guide.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";
import {
  agentRouteErrorHandler,
  clientIp,
  disabledError,
  jsonRpcError,
  noticeOnErrorResponses,
  requestOrigin,
  sendDeskError,
  toDeskError,
  withRpcNotice,
} from "./http.ts";
import { AGENT_BODY_LIMIT } from "./rest.ts";
import type { OrderDeskRuntime } from "./runtime.ts";
import { TOOL_DEFINITIONS, type CallContext } from "./service.ts";

const ORDER_URI = /^brickworks:\/\/orders\/(ao-[0-9a-z]{10})(\/updates)?$/;
const NOTIFY_DEBOUNCE_MS = 1000;

interface McpSession {
  id: string;
  owner: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
  subscriptions: Set<string>;
  pending: Map<string, NodeJS.Timeout>;
  unsubscribe: () => void;
}

/** Every JSON-RPC message the server sends (results, errors) carries the virtual notice. */
class VirtualNoticeTransport extends StreamableHTTPServerTransport {
  override send(message: JSONRPCMessage, options?: Parameters<StreamableHTTPServerTransport["send"]>[1]) {
    return super.send(withRpcNotice(message), options);
  }
}

/** Hosts and origins allowed on /mcp (DNS rebinding protection required by Streamable HTTP). */
export function hostAllowed(host: string | undefined, publicBaseUrl: string | null) {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(name)) return true;
  return publicBaseUrl !== null && new URL(publicBaseUrl).hostname.toLowerCase() === name;
}
export function originAllowed(origin: string | undefined, publicBaseUrl: string | null) {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (publicBaseUrl !== null && url.origin === new URL(publicBaseUrl).origin) return true;
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export class McpEndpoint {
  private readonly sessions = new Map<string, McpSession>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly runtime: OrderDeskRuntime) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
    runtime.onDisable(() => this.closeAll());
  }

  get size() {
    return this.sessions.size;
  }

  private sweep() {
    const now = Date.now();
    for (const session of this.sessions.values())
      if (now - session.lastSeen > this.runtime.config.mcpSessionIdleMs) void this.close(session);
  }

  private async close(session: McpSession) {
    if (!this.sessions.delete(session.id)) return;
    session.unsubscribe();
    for (const timer of session.pending.values()) clearTimeout(timer);
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }

  closeAll() {
    for (const session of [...this.sessions.values()]) void this.close(session);
  }

  shutdown() {
    clearInterval(this.sweeper);
    this.closeAll();
  }

  /** One McpServer per session, bound to the authenticated agent (or the anonymous reader). */
  private buildServer(agent: Agent | null, base: Omit<CallContext, "signal" | "onProgress">, session: { subscriptions: Set<string> }) {
    const service = this.runtime.service;
    const server = new McpServer(
      { name: "brickworks-order-desk", title: "Brickworks order desk (virtual)", version: "1.0.0" },
      { instructions: ORDERING_GUIDE },
    );
    /** One path for every tool call: service.call validates, so all failures share the orderDeskError body. */
    const runTool = async (name: string, args: unknown, signal: AbortSignal, progressToken: string | number | undefined, sendNotification: (n: never) => Promise<void>) => {
      const ctx: CallContext = {
        ...base,
        signal,
        onProgress:
          progressToken === undefined
            ? undefined
            : (progress, message) =>
                void sendNotification({ method: "notifications/progress", params: { progressToken, progress, total: 1, message } } as never).catch(() => undefined),
      };
      try {
        const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
        if (!tool) throw new OrderDeskError("VALIDATION_FAILED", `Unknown tool ${String(name).slice(0, 64)}.`);
        const result = await service.call(tool.name, args, ctx);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        // The orderDeskError body (with the virtual notice) travels as JSON text, not
        // structuredContent: SDK clients validate structuredContent against the tool's success
        // outputSchema even on isError results, which would turn every desk error into a throw.
        const body = toDeskError(error).body();
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(body) }] };
      }
    };
    for (const tool of TOOL_DEFINITIONS) {
      // Registered for tools/list (schemas and annotations); calls go through the handler below.
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input as never,
          outputSchema: tool.output as never,
          annotations: { readOnlyHint: tool.readOnly, idempotentHint: tool.idempotent, destructiveHint: false, openWorldHint: false },
        },
        (async (args: unknown, extra: { signal: AbortSignal; _meta?: { progressToken?: string | number }; sendNotification: (n: never) => Promise<void> }) =>
          runTool(tool.name, args, extra.signal, extra._meta?.progressToken, extra.sendNotification)) as never,
      );
    }
    // Replaces the SDK's tools/call handler so the SDK's own input validation (plain-text errors
    // with no virtual notice) never runs; service.call applies the same strict schemas.
    server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      runTool(request.params.name, request.params.arguments ?? {}, extra.signal, request.params._meta?.progressToken, extra.sendNotification as never),
    );
    const json = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) }] });
    const read = async (tool: OrderToolName, input: unknown) => {
      try {
        return await service.call(tool, input, base);
      } catch (error) {
        const desk = toDeskError(error);
        throw new McpError(desk.code === "ORDER_NOT_FOUND" ? ErrorCode.InvalidParams : ErrorCode.InternalError, `${desk.code}: ${desk.message}`, desk.body());
      }
    };
    server.registerResource("catalog", "brickworks://catalog", { title: "Vehicle catalog", mimeType: "application/json" }, async (uri) => json(uri, await read("list_vehicle_configs", {})));
    server.registerResource("capabilities", "brickworks://capabilities", { title: "Factory capabilities", mimeType: "application/json" }, async (uri) => json(uri, await read("get_capabilities", {})));
    server.registerResource("ordering-guide", "brickworks://docs/ordering-guide", { title: "Ordering guide", mimeType: "text/markdown" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: ORDERING_GUIDE }],
    }));
    const myActiveOrders = async () => {
      if (!agent?.scopes.includes("order:read")) return [];
      const listed = (await read("list_orders", { limit: 50 })) as { orders: Array<{ orderId: string; status: string }> };
      return listed.orders.filter((o) => !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(o.status));
    };
    server.registerResource(
      "order",
      new ResourceTemplate("brickworks://orders/{orderId}", {
        list: async () => ({
          resources: (await myActiveOrders()).map((o) => ({ uri: `brickworks://orders/${o.orderId}`, name: `Order ${o.orderId}`, mimeType: "application/json" })),
        }),
      }),
      { title: "One of your orders", mimeType: "application/json" },
      async (uri, variables) => json(uri, await read("get_order", { orderId: String(variables.orderId) })),
    );
    server.registerResource(
      "order-updates",
      new ResourceTemplate("brickworks://orders/{orderId}/updates", { list: undefined }),
      { title: "Last 50 updates of one of your orders", mimeType: "application/json" },
      async (uri, variables) => {
        const orderId = String(variables.orderId);
        await read("get_order", { orderId });
        return json(uri, withVirtualNotice({ orderId, updates: this.runtime.floor().desk.recentUpdates(orderId, 50) }));
      },
    );
    server.server.registerCapabilities({ resources: { subscribe: true, listChanged: false } });
    server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const match = ORDER_URI.exec(request.params.uri);
      if (!match) throw new McpError(ErrorCode.InvalidParams, "Only brickworks://orders/{orderId} and its /updates can be subscribed.");
      await read("get_order", { orderId: match[1] });
      session.subscriptions.add(request.params.uri);
      return {};
    });
    server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      session.subscriptions.delete(request.params.uri);
      return {};
    });
    return server;
  }

  /** Debounced notifications/resources/updated for subscribed orders only. */
  private notify(session: McpSession, orderId: string) {
    const uris = [`brickworks://orders/${orderId}`, `brickworks://orders/${orderId}/updates`].filter((uri) => session.subscriptions.has(uri));
    if (!uris.length || session.pending.has(orderId)) return;
    const timer = setTimeout(() => {
      session.pending.delete(orderId);
      for (const uri of uris) void session.server.server.sendResourceUpdated({ uri }).catch(() => undefined);
    }, NOTIFY_DEBOUNCE_MS);
    timer.unref();
    session.pending.set(orderId, timer);
  }

  register(app: FastifyInstance) {
    app.route({
      method: ["GET", "POST", "DELETE"],
      url: "/mcp",
      bodyLimit: AGENT_BODY_LIMIT,
      // Parser, size and content-type failures as JSON-RPC errors, with the notice in error.data.
      errorHandler: (error, request, reply) => {
        const status = typeof error.statusCode === "number" ? error.statusCode : 500;
        if (status === 413) return jsonRpcError(reply, 413, -32000, "Request body too large (64 KB limit).");
        if (status === 415) return jsonRpcError(reply, 415, -32000, "Unsupported Media Type: Content-Type must be application/json.");
        if (status >= 400 && status < 500) return jsonRpcError(reply, 400, -32700, "Parse error: Invalid JSON.");
        return agentRouteErrorHandler(error, request, reply);
      },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!this.runtime.active()) return sendDeskError(reply, disabledError());
        const base = this.runtime.config.publicBaseUrl;
        if (!hostAllowed(request.headers.host, base)) return jsonRpcError(reply, 403, -32000, "Host not allowed.");
        if (!originAllowed(request.headers.origin, base)) return jsonRpcError(reply, 403, -32000, "Origin not allowed.");
        let agent: Agent | null;
        try {
          agent = this.runtime.authenticate(request);
          if (!agent && !this.runtime.config.anonRead)
            throw this.runtime.limiter.rejected(clientIp(request), new OrderDeskError("UNAUTHORIZED", "A bearer agent key is required."));
        } catch (error) {
          return sendDeskError(reply, error);
        }
        const owner = agent ? `agent:${agent.id}` : "anonymous";
        const header = request.headers["mcp-session-id"];
        const sessionId = Array.isArray(header) ? header[0] : header;
        let session = sessionId ? this.sessions.get(sessionId) : undefined;
        if (sessionId) {
          // A session belongs to the key that created it; anyone else gets 404, the same as an unknown id.
          if (!session || session.owner !== owner) return jsonRpcError(reply, 404, -32001, "Session not found.");
          session.lastSeen = Date.now();
          if (request.method === "DELETE") {
            reply.hijack();
            noticeOnErrorResponses(reply.raw);
            await session.transport.handleRequest(request.raw, reply.raw, request.body);
            await this.close(session);
            return;
          }
        } else {
          if (request.method !== "POST" || !isInitializeRequest(request.body))
            return jsonRpcError(reply, 400, -32000, "Missing Mcp-Session-Id; start with an initialize request.");
          if (this.sessions.size >= this.runtime.config.maxMcpSessions) this.sweep();
          if (this.sessions.size >= this.runtime.config.maxMcpSessions) {
            reply.header("Retry-After", "60");
            return jsonRpcError(reply, 503, -32000, "Too many MCP sessions; retry later.");
          }
          const ctx = { agent, ip: clientIp(request), requestOrigin: requestOrigin(request) };
          const subscriptions = new Set<string>();
          const server = this.buildServer(agent, ctx, { subscriptions });
          const created: McpSession = {
            id: "",
            owner,
            transport: undefined as never,
            server,
            lastSeen: Date.now(),
            subscriptions,
            pending: new Map(),
            unsubscribe: () => undefined,
          };
          const transport = new VirtualNoticeTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              created.id = id;
              this.sessions.set(id, created);
              created.unsubscribe = this.runtime.floor().onUpdate((update) => this.notify(created, update.orderId));
            },
          });
          transport.onclose = () => void this.close(created);
          created.transport = transport;
          await server.connect(transport);
          session = created;
        }
        reply.hijack();
        noticeOnErrorResponses(reply.raw);
        await session.transport.handleRequest(request.raw, reply.raw, request.body);
      },
    });
  }
}
