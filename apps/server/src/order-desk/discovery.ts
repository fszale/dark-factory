import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { VIRTUAL_DISCLAIMER } from "../../../../packages/contracts/src/orders.ts";
import { ORDERING_GUIDE } from "./guide.ts";
import { disabledError, requestOrigin, sendDeskError } from "./http.ts";
import { REST_BASE } from "./rest.ts";
import type { OrderDeskRuntime } from "./runtime.ts";
import { TOOL_DEFINITIONS } from "./service.ts";

export const SERVER_CARD_NAME = "io.github.fszale/brickworks-order-desk";
export const SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const REPOSITORY = "https://github.com/fszale/dark-factory";
const SPEC = `${REPOSITORY}/blob/main/docs/plans/vehicle-order-mcp.md`;

/** Every discovery document is generated from the same tool registry and base URL. */
export function discoveryDocuments(base: string) {
  const tools = TOOL_DEFINITIONS.map((t) => ({ name: t.name, title: t.title, description: t.description }));
  const card = {
    $schema: SERVER_CARD_SCHEMA,
    name: SERVER_CARD_NAME,
    title: "Brickworks order desk (virtual)",
    version: "1.0.0",
    description: "Quote, order and track virtual robotaxis built on a simulated Brickworks dark factory.",
    websiteUrl: base,
    repository: { url: REPOSITORY, source: "github" },
    remotes: [{ type: "streamable-http", url: `${base}/mcp` }],
    _meta: {
      "io.github.fszale/brickworks": {
        virtual: true,
        disclaimer: VIRTUAL_DISCLAIMER,
        auth: { type: "bearer", anonymousTools: ["list_vehicle_configs", "get_capabilities"], keyRequest: `${REPOSITORY}/issues` },
        docs: { llms: `${base}/llms.txt`, openapi: `${base}${REST_BASE}/openapi.json`, spec: SPEC },
        tools,
      },
    },
  };
  const catalog = {
    version: "draft",
    note: "Discovery paths are not standardized yet (SEP-2127 is experimental); this catalog lists the server card.",
    servers: [{ name: SERVER_CARD_NAME, card: `${base}/mcp/server-card`, url: `${base}/mcp` }],
  };
  const llms = `# Brickworks order desk (virtual)

> ${VIRTUAL_DISCLAIMER}

Brickworks is a simulated dark factory that builds a gold two-seat robotaxi from five lines (front, rear, battery and floor, interior, exterior). The order desk lets an AI agent quote, order and track virtual vehicles that are really built, inspected, parked and dispatched on a shared simulated order floor, then delivered by a seeded virtual carrier.

- MCP endpoint (Streamable HTTP): ${base}/mcp
- REST mirror: ${base}${REST_BASE}
- OpenAPI: ${base}${REST_BASE}/openapi.json
- Server card: ${base}/mcp/server-card
- Spec: ${SPEC}

## Access

Catalog and capabilities are readable without a key. Every other tool needs a bearer agent key. To request one, open an issue at ${REPOSITORY}/issues; Filip decides. Keys are never published.

## Tools

${tools.map((t) => `- \`${t.name}\`: ${t.description}`).join("\n")}

${ORDERING_GUIDE}`;
  return { card, catalog, llms };
}

export function registerDiscovery(app: FastifyInstance, runtime: OrderDeskRuntime) {
  const docs = (request: FastifyRequest) => discoveryDocuments(runtime.config.publicBaseUrl ?? requestOrigin(request) ?? "http://localhost:3000");
  const headers = (reply: FastifyReply) => reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "public, max-age=300");
  const route = (path: string, render: (request: FastifyRequest, reply: FastifyReply) => unknown) =>
    app.get(path, async (request, reply) => {
      // A disabled desk advertises nothing, rather than an endpoint that answers 503.
      if (!runtime.active()) return sendDeskError(reply, disabledError());
      headers(reply);
      return render(request, reply);
    });
  route("/llms.txt", (request, reply) => reply.type("text/markdown; charset=utf-8").send(docs(request).llms));
  route("/mcp/server-card", (request) => docs(request).card);
  route("/.well-known/mcp.json", (request) => docs(request).card);
  route("/.well-known/mcp/catalog.json", (request) => docs(request).catalog);
}
