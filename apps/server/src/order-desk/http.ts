import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasVirtualNotice, ORDER_DESK_ERROR_HTTP, VIRTUAL_NOTICE, type OrderDeskErrorCode } from "../../../../packages/contracts/src/orders.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";

/** Maps any thrown value to the shared orderDeskError body and HTTP status. Internal errors never leak details. */
export function toDeskError(error: unknown): OrderDeskError {
  if (error instanceof OrderDeskError) return error;
  return new OrderDeskError("FLOOR_UNAVAILABLE", "The order desk hit an internal error; retry shortly.", true, { retryAfterSeconds: 5 });
}

/** Sends the orderDeskError body (which always carries the virtual notice). */
export function sendDeskError(reply: FastifyReply, error: unknown, statusOverride?: number) {
  const desk = toDeskError(error);
  const status = statusOverride ?? ORDER_DESK_ERROR_HTTP[desk.code as OrderDeskErrorCode] ?? 500;
  if (desk.extra.retryAfterSeconds !== undefined) reply.header("Retry-After", String(desk.extra.retryAfterSeconds));
  if (desk.code === "UNAUTHORIZED") reply.header("WWW-Authenticate", 'Bearer realm="brickworks-order-desk"');
  return reply.code(status).send(desk.body());
}

/**
 * Route-level Fastify error handler for every agent-facing route. Parser, body-size and
 * content-type failures happen before the handler runs; without this they would come back as
 * Fastify's default body with no virtual notice.
 */
export function agentRouteErrorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof OrderDeskError) return sendDeskError(reply, error);
  const status = typeof error.statusCode === "number" ? error.statusCode : 500;
  if (status === 413) return sendDeskError(reply, new OrderDeskError("VALIDATION_FAILED", "The request body is too large (64 KB limit)."), 413);
  if (status === 415) return sendDeskError(reply, new OrderDeskError("VALIDATION_FAILED", "Content-Type must be application/json."), 415);
  if (status >= 400 && status < 500) return sendDeskError(reply, new OrderDeskError("VALIDATION_FAILED", "The request body is not valid JSON."), 400);
  return sendDeskError(reply, error);
}

export function disabledError() {
  return new OrderDeskError("ORDER_DESK_DISABLED", "The order desk is disabled.", true);
}

/**
 * Adds the virtual notice to an outgoing JSON-RPC message: `error.data` for errors and
 * `result._meta` for results. Both are the places JSON-RPC and MCP leave open for extra data,
 * so strict clients still accept the message.
 */
export function withRpcNotice<T>(message: T): T {
  if (Array.isArray(message)) return message.map((m) => withRpcNotice(m)) as T;
  if (!message || typeof message !== "object") return message;
  const record = message as Record<string, unknown>;
  if (record.jsonrpc !== "2.0") return message;
  const error = record.error as Record<string, unknown> | undefined;
  if (error && typeof error === "object") {
    if (hasVirtualNotice(error.data)) return message;
    const data = error.data;
    const merged =
      data && typeof data === "object" && !Array.isArray(data)
        ? { ...(data as Record<string, unknown>), ...VIRTUAL_NOTICE }
        : { ...(data !== undefined ? { detail: data } : {}), ...VIRTUAL_NOTICE };
    return { ...record, error: { ...error, data: merged } } as T;
  }
  const result = record.result as Record<string, unknown> | undefined;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const meta = result._meta && typeof result._meta === "object" ? (result._meta as Record<string, unknown>) : {};
    return { ...record, result: { ...result, _meta: { ...meta, ...VIRTUAL_NOTICE } } } as T;
  }
  return message;
}

/** A JSON-RPC error response written by the order desk itself, with the notice in `error.data`. */
export const jsonRpcError = (reply: FastifyReply, status: number, code: number, message: string) =>
  reply.code(status).send(withRpcNotice({ jsonrpc: "2.0", error: { code, message }, id: null }));

/**
 * The MCP SDK transport writes its own JSON error responses (406, 409, 400 and so on) straight to
 * the socket. This buffers any response with status 400 or above and a JSON body, adds the virtual
 * notice through withRpcNotice, and fixes Content-Length. Streams (status 200) pass through untouched.
 */
export function noticeOnErrorResponses(res: ServerResponse) {
  const writeHead = res.writeHead.bind(res) as (status: number, ...rest: unknown[]) => ServerResponse;
  const write = res.write.bind(res) as (...args: unknown[]) => boolean;
  const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
  let held: { status: number; reason?: string; headers: OutgoingHttpHeaders } | null = null;
  const chunks: Buffer[] = [];
  const toBuffer = (chunk: unknown) => (typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  (res as { writeHead: unknown }).writeHead = (status: number, ...rest: unknown[]) => {
    if (status < 400) return writeHead(status, ...rest);
    const reason = typeof rest[0] === "string" ? (rest.shift() as string) : undefined;
    const headers = rest[0] && typeof rest[0] === "object" && !Array.isArray(rest[0]) ? { ...(rest[0] as OutgoingHttpHeaders) } : {};
    held = { status, reason, headers };
    return res;
  };
  (res as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]) => {
    if (!held) return write(chunk, ...rest);
    if (chunk !== undefined && chunk !== null && typeof chunk !== "function") chunks.push(toBuffer(chunk));
    return true;
  };
  (res as { end: unknown }).end = (chunk?: unknown, ...rest: unknown[]) => {
    if (!held) return end(chunk, ...rest);
    if (chunk !== undefined && chunk !== null && typeof chunk !== "function") chunks.push(toBuffer(chunk));
    const { status, reason, headers } = held;
    held = null;
    let body = Buffer.concat(chunks);
    const type = String(headers["content-type"] ?? headers["Content-Type"] ?? res.getHeader("content-type") ?? "");
    if (type.includes("application/json")) {
      try {
        body = Buffer.from(JSON.stringify(withRpcNotice(JSON.parse(body.toString("utf8")))));
      } catch {
        // Not JSON after all; send it unchanged.
      }
    }
    for (const key of Object.keys(headers)) if (key.toLowerCase() === "content-length") delete headers[key];
    res.removeHeader("content-length");
    headers["content-length"] = String(body.length);
    if (reason !== undefined) writeHead(status, reason, headers);
    else writeHead(status, headers);
    return end(body);
  };
}

export function clientIp(request: FastifyRequest) {
  return request.ip || "unknown";
}

export function requestOrigin(request: FastifyRequest) {
  const host = request.headers.host;
  return host ? `${request.protocol}://${host}` : undefined;
}
