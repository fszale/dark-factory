import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode, isInitializeRequest, McpError, SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TERMINAL_ORDER_STATUSES, type OrderToolName } from "../../../../packages/contracts/src/orders.ts";
import type { Agent } from "./auth.ts";
import { ORDERING_GUIDE } from "./guide.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";
import { clientIp, disabledError, requestOrigin, sendDeskError, toDeskError } from "./http.ts";
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

const jsonRpcError = (reply: FastifyReply, status: number, code: number, message: string) =>
  reply.code(status).send({ jsonrpc: "2.0", error: { code, message }, id: null });

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
    for (const tool of TOOL_DEFINITIONS) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input as never,
          outputSchema: tool.output as never,
          annotations: { readOnlyHint: tool.readOnly, idempotentHint: tool.idempotent, destructiveHint: false, openWorldHint: false },
        },
        (async (args: unknown, extra: { signal: AbortSignal; _meta?: { progressToken?: string | number }; sendNotification: (n: never) => Promise<void> }) => {
          const token = extra._meta?.progressToken;
          const ctx: CallContext = {
            ...base,
            signal: extra.signal,
            onProgress:
              token === undefined
                ? undefined
                : (progress, message) =>
                    void extra
                      .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total: 1, message } } as never)
                      .catch(() => undefined),
          };
          try {
            const result = (await service.call(tool.name as OrderToolName, args, ctx)) as Record<string, unknown>;
            return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
          } catch (error) {
            const body = toDeskError(error).body();
            return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
          }
        }) as never,
      );
    }
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
        return json(uri, { orderId, updates: this.runtime.floor().desk.recentUpdates(orderId, 50) });
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
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!this.runtime.active()) return sendDeskError(reply, disabledError());
        const base = this.runtime.config.publicBaseUrl;
        if (!hostAllowed(request.headers.host, base)) return jsonRpcError(reply, 403, -32000, "Host not allowed.");
        if (!originAllowed(request.headers.origin, base)) return jsonRpcError(reply, 403, -32000, "Origin not allowed.");
        let agent: Agent | null;
        try {
          agent = this.runtime.authenticate(request);
          if (!agent && !this.runtime.config.anonRead) throw new OrderDeskError("UNAUTHORIZED", "A bearer agent key is required.");
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
          const transport = new StreamableHTTPServerTransport({
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
        await session.transport.handleRequest(request.raw, reply.raw, request.body);
      },
    });
  }
}
