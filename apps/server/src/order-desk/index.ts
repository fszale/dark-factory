import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { commandSchema } from "../../../../packages/contracts/src/index.ts";
import { agentOrderId } from "../../../../packages/contracts/src/orders.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";
import type { OrderDeskOptions } from "./config.ts";
import { registerDiscovery } from "./discovery.ts";
import { disabledError, sendDeskError } from "./http.ts";
import { McpEndpoint } from "./mcp.ts";
import { registerRest } from "./rest.ts";
import { OrderDeskRuntime } from "./runtime.ts";

export type { OrderDeskOptions } from "./config.ts";
export { OrderDeskRuntime } from "./runtime.ts";

const runtimes = new WeakMap<FastifyInstance, OrderDeskRuntime>();
/** Test and scenario access to the runtime (manual clock, floor, desk). */
export function getOrderDeskRuntime(app: FastifyInstance) {
  return runtimes.get(app) ?? null;
}

export interface OperatorAuth {
  /** True when the operator access code matches (or no code is configured and the server is not public). */
  allows: (code: string | undefined) => boolean;
}

const code = z.string().max(256).optional();
const commandBody = z.object({ accessCode: code, command: commandSchema }).strict();
const carrierBody = z
  .object({
    accessCode: code,
    action: z.enum(["carrier-hold", "carrier-release", "carrier-lose"]),
    orderId: agentOrderId,
    unitIndex: z.number().int().min(0).max(2),
  })
  .strict();
const intakeBody = z.object({ accessCode: code, paused: z.boolean() }).strict();
const killBody = z.object({ accessCode: code, thrown: z.boolean() }).strict();
const importBody = z.object({ accessCode: code, state: z.unknown() }).strict();

/**
 * DF-ORDER-001: registers /mcp, /api/agent/v1/*, discovery documents and the
 * operator /api/order-floor/* routes. With the desk disabled every one of
 * them is still registered (so the SPA fallback never swallows them) and
 * answers 503 ORDER_DESK_DISABLED; no floor exists.
 */
export function registerOrderDesk(app: FastifyInstance, options: OrderDeskOptions | undefined, operator: OperatorAuth) {
  const runtime = new OrderDeskRuntime(options, app.log);
  runtimes.set(app, runtime);
  const mcp = new McpEndpoint(runtime);
  mcp.register(app);
  registerRest(app, runtime, runtime.service);
  registerDiscovery(app, runtime);

  const testOnly = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const header = (request: FastifyRequest) => {
    const value = request.headers["x-access-code"];
    return Array.isArray(value) ? value[0] : value;
  };
  const denied = () => new OrderDeskError("FORBIDDEN_SCOPE", "Operator access code required.");
  const floorOrDisabled = () => {
    const floor = runtime.floorForOperator();
    if (!floor) throw disabledError();
    return floor;
  };

  // With the desk disabled every operator route except status answers 503 before validating anything.
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/order-floor/") || request.url.startsWith("/api/order-floor/status")) return;
    if (!runtime.hasFloor) return sendDeskError(reply, disabledError());
  });

  app.get("/api/order-floor/status", async () => ({
    enabled: runtime.config.enabled,
    active: runtime.active(),
    killSwitch: runtime.killSwitchThrown,
    publicView: runtime.config.enabled && runtime.config.publicView,
    intakePaused: runtime.floorForOperator()?.desk.intakePaused ?? false,
    mcpSessions: mcp.size,
    virtual: true,
  }));

  app.get("/api/order-floor/view", async (request, reply) => {
    try {
      if (!runtime.config.publicView && !operator.allows(header(request))) throw denied();
      return runtime.floor().desk.deskView();
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  app.post("/api/order-floor/command", async (request, reply) => {
    try {
      const body = commandBody.safeParse(request.body ?? {});
      if (!body.success) throw new OrderDeskError("VALIDATION_FAILED", "Invalid floor command.");
      if (!operator.allows(body.data.accessCode)) throw denied();
      const result = runtime.floor().operatorCommand(body.data.command);
      return reply.code(result.ok ? 200 : 409).send(result);
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  app.post("/api/order-floor/carrier", async (request, reply) => {
    try {
      const body = carrierBody.safeParse(request.body ?? {});
      if (!body.success) throw new OrderDeskError("VALIDATION_FAILED", "Invalid carrier control.");
      if (!operator.allows(body.data.accessCode)) throw denied();
      if (body.data.action === "carrier-lose" && !testOnly) throw new OrderDeskError("FORBIDDEN_SCOPE", "carrier-lose is test-only.");
      const changed = runtime.floor().carrierControl(body.data.action, body.data.orderId, body.data.unitIndex);
      return { ok: changed };
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  app.post("/api/order-floor/intake", async (request, reply) => {
    try {
      const body = intakeBody.safeParse(request.body ?? {});
      if (!body.success) throw new OrderDeskError("VALIDATION_FAILED", "Invalid intake toggle.");
      if (!operator.allows(body.data.accessCode)) throw denied();
      runtime.floor().desk.setIntakePaused(body.data.paused);
      return { intakePaused: runtime.floor().desk.intakePaused };
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  /** Runtime kill switch next to the ORDER_DESK_ENABLED env flag. */
  app.post("/api/order-floor/kill-switch", async (request, reply) => {
    try {
      const body = killBody.safeParse(request.body ?? {});
      if (!body.success) throw new OrderDeskError("VALIDATION_FAILED", "Invalid kill switch request.");
      if (!operator.allows(body.data.accessCode)) throw denied();
      floorOrDisabled();
      runtime.setKilled(body.data.thrown);
      return { killSwitch: runtime.killSwitchThrown, active: runtime.active() };
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  app.get("/api/order-floor/export", async (request, reply) => {
    try {
      if (!operator.allows(header(request))) throw denied();
      reply.header("Cache-Control", "no-store").header("Content-Disposition", 'attachment; filename="order-floor.json"');
      return floorOrDisabled().exportState();
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  app.post("/api/order-floor/import", { bodyLimit: 32 * 1024 * 1024 }, async (request, reply) => {
    try {
      const body = importBody.safeParse(request.body ?? {});
      if (!body.success) throw new OrderDeskError("VALIDATION_FAILED", "Invalid import request.");
      if (!operator.allows(body.data.accessCode)) throw denied();
      runtime.floor().importState(body.data.state);
      mcp.closeAll();
      return { ok: true, simTime: runtime.floor().sim.snapshot().time };
    } catch (error) {
      return sendDeskError(reply, error);
    }
  });

  app.addHook("onClose", async () => {
    mcp.shutdown();
    runtime.close();
  });
  return runtime;
}
