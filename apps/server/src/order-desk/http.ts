import type { FastifyReply, FastifyRequest } from "fastify";
import { ORDER_DESK_ERROR_HTTP, type OrderDeskErrorCode } from "../../../../packages/contracts/src/orders.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";

/** Maps any thrown value to the shared orderDeskError body and HTTP status. Internal errors never leak details. */
export function toDeskError(error: unknown): OrderDeskError {
  if (error instanceof OrderDeskError) return error;
  return new OrderDeskError("FLOOR_UNAVAILABLE", "The order desk hit an internal error; retry shortly.", true, { retryAfterSeconds: 5 });
}

export function sendDeskError(reply: FastifyReply, error: unknown) {
  const desk = toDeskError(error);
  const status = ORDER_DESK_ERROR_HTTP[desk.code as OrderDeskErrorCode] ?? 500;
  if (desk.extra.retryAfterSeconds !== undefined) reply.header("Retry-After", String(desk.extra.retryAfterSeconds));
  if (desk.code === "UNAUTHORIZED") reply.header("WWW-Authenticate", 'Bearer realm="brickworks-order-desk"');
  return reply.code(status).send(desk.body());
}

export function disabledError() {
  return new OrderDeskError("ORDER_DESK_DISABLED", "The order desk is disabled.", true);
}

export function clientIp(request: FastifyRequest) {
  return request.ip || "unknown";
}

export function requestOrigin(request: FastifyRequest) {
  const host = request.headers.host;
  return host ? `${request.protocol}://${host}` : undefined;
}
