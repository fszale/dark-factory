import { Worker } from "node:worker_threads";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { RunExport } from "../../../../packages/contracts/src/index.ts";
import { OrderDeskError } from "../../../../packages/orders/src/desk.ts";
import { runForecast, type ForecastRequest, type ForecastResult } from "../../../../packages/orders/src/forecast.ts";
import { AgentKeyring, ForecastQueue, RateLimiter, type Agent } from "./auth.ts";
import { resolveOrderDeskConfig, type Forecaster, type OrderDeskConfig, type OrderDeskOptions } from "./config.ts";
import { OrderFloor } from "./floor.ts";
import { clientIp, disabledError } from "./http.ts";
import { OrderDeskService } from "./service.ts";
import { WebhookDispatcher } from "./webhooks.ts";

/** Forecasts run in a worker thread in production so a fork never blocks the floor tick or HTTP. */
export function workerForecaster(run: RunExport, request: ForecastRequest) {
  return new Promise<ForecastResult>((resolvePromise, reject) => {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const url = extension === "ts" ? new URL("../forecast-worker.ts", import.meta.url) : new URL("./forecast-worker.js", import.meta.url);
    const worker = new Worker(url, { workerData: { run, request } });
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("forecast worker timed out"));
    }, 30_000);
    timeout.unref();
    worker.once("message", (value: ForecastResult) => {
      clearTimeout(timeout);
      resolvePromise(value);
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`forecast worker exited ${code}`));
      }
    });
  });
}

const inlineForecaster: Forecaster = async (run, request) => runForecast(run, request);

/**
 * Everything the order desk needs at runtime. When the env flag is off this
 * object still exists so routes answer 503, but no floor is created.
 */
export class OrderDeskRuntime {
  readonly config: OrderDeskConfig;
  readonly keyring: AgentKeyring;
  readonly limiter: RateLimiter;
  readonly queue: ForecastQueue;
  readonly service: OrderDeskService;
  readonly now: () => number;
  private floorInstance: OrderFloor | null = null;
  private killed = false;
  private readonly disableListeners = new Set<() => void>();
  webhooks: WebhookDispatcher | null = null;

  constructor(options: OrderDeskOptions | undefined, private readonly log: FastifyBaseLogger) {
    this.config = resolveOrderDeskConfig(options);
    this.now = options?.now ?? Date.now;
    this.keyring = new AgentKeyring(this.config.agentKeys);
    this.limiter = new RateLimiter(this.config.rateLimits, this.now);
    this.queue = new ForecastQueue(this.config.rateLimits.forecastQueue);
    this.service = new OrderDeskService({ config: this.config, limiter: this.limiter, floor: () => this.floor(), active: () => this.active() });
    if (this.config.agentKeyError) log.warn({ reason: this.config.agentKeyError }, "BRICKWORKS_AGENT_KEYS is invalid; no agent keys are active");
    if (!this.config.enabled) return;
    const raw = options?.forecaster ?? (process.env.VITEST === "true" ? inlineForecaster : workerForecaster);
    const forecaster: Forecaster = (run, request) => this.queue.run(() => raw(run, request));
    const logger = {
      info: (value: Record<string, unknown>, message: string) => log.info(value, message),
      warn: (value: Record<string, unknown>, message: string) => log.warn(value, message),
    };
    this.floorInstance = new OrderFloor({ config: this.config, forecaster, now: this.now, logger }).open();
    this.webhooks = new WebhookDispatcher({
      enabled: this.config.webhooksEnabled,
      fetch: options?.webhookFetch,
      resolve: options?.webhookResolve,
      retryDelaysMs: options?.webhookRetryDelaysMs,
      logger,
    });
    this.floorInstance.onUpdate((update) => {
      const agentId = this.floorInstance?.desk.orderBrief(update.orderId)?.agentId;
      const agent = agentId ? this.agentById(agentId) : null;
      if (agent?.webhook) this.webhooks?.deliver(agent.webhook, update);
    });
    log.info({ floor: "order-floor", scenario: this.config.scenario, restoredFrom: this.floorInstance.restoredFrom, agentKeys: this.keyring.size }, "order desk enabled");
  }

  private agentById(id: string): Agent | null {
    return this.config.agentKeys.find((k) => k.id === id)
      ? (() => {
          const key = this.config.agentKeys.find((k) => k.id === id)!;
          return { id: key.id, label: key.label, scopes: [...key.scopes], maxActiveOrders: key.maxActiveOrders, webhook: key.webhook };
        })()
      : null;
  }

  /** On only when the env flag is on and the operator kill switch has not been thrown. */
  active() {
    return this.config.enabled && !this.killed && this.floorInstance !== null;
  }

  get hasFloor() {
    return this.floorInstance !== null;
  }

  floor(): OrderFloor {
    if (!this.floorInstance || !this.active()) throw disabledError();
    return this.floorInstance;
  }

  /** The floor even while the kill switch is thrown (operator export and status only). */
  floorForOperator(): OrderFloor | null {
    return this.floorInstance;
  }

  /** No header means anonymous; a header that does not match a key is an error, never anonymous. */
  authenticate(request: FastifyRequest): Agent | null {
    if (!this.active()) throw disabledError();
    const header = request.headers.authorization;
    if (header === undefined) return null;
    const agent = this.keyring.authenticate(Array.isArray(header) ? header[0] : header);
    // Bad keys count against the per-IP flood window; past it the caller gets 429 instead of 401.
    if (!agent) throw this.limiter.rejected(clientIp(request), new OrderDeskError("UNAUTHORIZED", "The bearer key is not valid."));
    return agent;
  }

  onDisable(listener: () => void) {
    this.disableListeners.add(listener);
    return () => {
      this.disableListeners.delete(listener);
    };
  }

  /** Runtime kill switch: stops the floor clock, closes every agent stream, and answers 503 until re-enabled. */
  setKilled(killed: boolean) {
    if (!this.floorInstance) return false;
    if (killed === this.killed) return true;
    this.killed = killed;
    if (killed) {
      this.floorInstance.stopClock();
      this.floorInstance.persist();
      for (const listener of [...this.disableListeners]) {
        try {
          listener();
        } catch {
          // Closing a dead stream must not block the switch.
        }
      }
    } else this.floorInstance.resumeClock();
    this.log.warn({ killSwitch: killed ? "thrown" : "released" }, "order desk kill switch");
    return true;
  }

  get killSwitchThrown() {
    return this.killed;
  }

  close() {
    for (const listener of [...this.disableListeners]) {
      try {
        listener();
      } catch {
        // Ignore.
      }
    }
    this.webhooks?.close();
    this.floorInstance?.close();
  }
}
