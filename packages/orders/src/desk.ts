import { createHash, randomBytes } from "node:crypto";
import {
  LINE_IDS,
  type CommandResult,
  type FactoryCommand,
  type FactorySnapshot,
  type LineId,
  type ModuleReworkEvent,
  type RunExport,
} from "../../contracts/src/index.ts";
import {
  FLOOR_ID,
  TERMINAL_ORDER_STATUSES,
  VIRTUAL_DISCLAIMER,
  type AgentScope,
  type CancelOrderInput,
  type DeskOrderCard,
  type DestinationZone,
  type FeasibilityIssue,
  type GetOrderUpdatesInput,
  type GetOrderUpdatesOutput,
  type LeadOption,
  type LeadOptionQuote,
  type ListOrdersInput,
  type OrderDeskErrorCode,
  type OrderDeskView,
  type OrderStatus,
  type OrderSummary,
  type OrderUpdate,
  type OrderUpdateType,
  type OrderView,
  type PlaceOrderInput,
  type QuoteVehicleInput,
  type QuoteVehicleOutput,
  type StationProgress,
  type UnitView,
} from "../../contracts/src/orders.ts";
import type { AuditEntry } from "../../simulation/src/index.ts";
import {
  bridgeReduce,
  createBridgeState,
  type BridgeSignal,
  type BridgeState,
  type LineageSignal,
} from "./bridge.ts";
import {
  createCarrierPlan,
  etaSimTime,
  holdCarrier,
  MAX_CARRIER_DELAY_FACTOR,
  nextCarrierEventTime,
  nominalTransitSeconds,
  popNextCarrierEvent,
  releaseCarrier,
  trackingView,
  type CarrierEvent,
  type CarrierPlan,
} from "./carrier.ts";
import { findModel, resolvedOptions } from "./catalog.ts";
import { checkFeasibility, FLOOR_MAX_ACTIVE_AGENT_ORDERS, hasErrors, isZone } from "./feasibility.ts";
import { basisHash, FORECAST_HORIZON_SECONDS, type ForecastRequest, type ForecastResult } from "./forecast.ts";
import {
  aggregateStatus,
  initialOrderState,
  initialUnitState,
  isOrderFinal,
  orderTransition,
  unitKey,
  unitPublicStatus,
  unitStage,
  unitTransition,
  type OrderEvent,
  type OrderMachineState,
  type UnitEvent,
  type UnitStateValue,
} from "./lifecycle.ts";
import { LEAD_OPTION_PRIORITY, leadOptionPrice, PRICE_BOOK, priceLines } from "./pricing.ts";

export const QUOTE_TTL_MS = 10 * 60_000;
export const UPDATE_LOG_LIMIT = 5000;
export const UPDATE_LOG_PER_ORDER = 500;
export const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60_000;

export interface AgentIdentity {
  id: string;
  label: string;
  scopes: AgentScope[];
  maxActiveOrders: number;
}

/** The desk observes the floor and submits schema-checked commands; it never mutates the snapshot. */
export interface FloorPort {
  snapshot(): FactorySnapshot;
  exportRun(): RunExport;
  command(command: FactoryCommand): CommandResult;
  readonly stepSeconds: number;
  readonly seed: number;
}

export class OrderDeskError extends Error {
  constructor(
    readonly code: OrderDeskErrorCode,
    message: string,
    readonly retryable = false,
    readonly extra: { retryAfterSeconds?: number; issues?: FeasibilityIssue[] } = {},
  ) {
    super(message);
    this.name = "OrderDeskError";
  }
  body() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.extra.retryAfterSeconds !== undefined ? { retryAfterSeconds: this.extra.retryAfterSeconds } : {}),
        ...(this.extra.issues ? { issues: this.extra.issues } : {}),
      },
    };
  }
}

type Estimate = {
  completeBySimTime: number | null;
  shipBySimTime: number | null;
  deliverBySimTime: number | null;
  estimatedDeliveryAt: string | null;
};
interface UnitRecord {
  index: number;
  state: UnitStateValue;
  vehicleId: string | null;
  modules: Partial<Record<LineId, { id: string; lot: string; reworkHistory: ModuleReworkEvent[] }>>;
  carrier: CarrierPlan | null;
  passedAt: number | null;
  shippedAt: number | null;
  deliveredAt: number | null;
}
export interface OrderRecord {
  orderId: string;
  agentId: string;
  agentLabel: string;
  quoteId: string;
  config: { modelId: string; options: Record<string, string | number> };
  quantity: number;
  zone: DestinationZone;
  leadOption: LeadOption;
  priority: number;
  price: { amount: number; currency: "BWC-VIRTUAL" };
  agentReference: string | null;
  placedAt: string;
  placedAtWall: number;
  placedAtSimTime: number;
  placementSeq: number;
  factoryOrderId: string | null;
  machine: OrderMachineState;
  units: UnitRecord[];
  atRisk: string[];
  promised: Estimate;
  latestEstimate: Estimate & { confidence: LeadOptionQuote["confidence"] };
  lastStatus: OrderStatus | null;
  lastUpdateSeq: number;
  completedNotified: boolean;
  droppedThrough: number;
  terminalAt: number | null;
}
interface QuoteRecord {
  quoteId: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
  epoch: number;
  manufacturable: boolean;
  config: { modelId: string; options: Record<string, string | number> };
  quantity: number;
  zone: DestinationZone | null;
  leadOptions: LeadOptionQuote[];
  issues: FeasibilityIssue[];
  convertedTo: string | null;
  output: QuoteVehicleOutput;
}
interface IdempotencyRecord {
  kind: "place" | "cancel";
  fingerprint: string;
  orderId: string;
  createdAt: number;
}
export interface DeskState {
  formatVersion: 1;
  seq: number;
  updates: OrderUpdate[];
  quotes: Record<string, QuoteRecord>;
  orders: Record<string, OrderRecord>;
  placementSeq: number;
  idempotency: Record<string, IdempotencyRecord>;
  bridge: BridgeState;
  intakePaused: boolean;
  prunedTerminal: number;
  reforecastPending: boolean;
  lastReforecastAt: number;
  simTime: number;
}

export interface IntakeOrder {
  orderId: string;
  agentId: string;
  agentLabel: string;
  quoteId: string;
  config: { modelId: string; options: Record<string, string | number> };
  quantity: number;
  zone: DestinationZone;
  leadOption: LeadOption;
  priority: number;
  price: { amount: number; currency: "BWC-VIRTUAL" };
  agentReference: string | null;
  promised: Estimate;
  confidence: LeadOptionQuote["confidence"];
}
export type CarrierAction = "carrier-hold" | "carrier-release" | "carrier-lose";
/** Records the desk writes next to factory entries in the floor archive so the update log can be rebuilt. */
export type DeskArchiveRecord =
  | { kind: "intake"; action: "place"; simTime: number; order: IntakeOrder }
  | { kind: "intake"; action: "cancel"; simTime: number; orderId: string }
  | { kind: "desk-action"; action: CarrierAction; simTime: number; orderId: string; unitIndex: number };

export interface DeskLogger {
  info: (value: Record<string, unknown>, message: string) => void;
  warn: (value: Record<string, unknown>, message: string) => void;
}
export interface DeskOptions {
  floor: FloorPort | null;
  now: () => number;
  forecaster?: (run: RunExport, request: ForecastRequest) => Promise<ForecastResult>;
  quoteTtlMs?: number;
  maxActiveAgentOrders?: number;
  deliveryTimeScale?: number;
  reforecastIntervalMs?: number;
  record?: (record: DeskArchiveRecord) => void;
  logger?: DeskLogger;
  randomId?: (prefix: "ao" | "aq") => string;
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function randomDeskId(prefix: "ao" | "aq") {
  let id = "";
  for (const byte of randomBytes(10)) id += ALPHABET[byte % 36];
  return `${prefix}-${id}`;
}

const MODULE_LINE = /^module-([a-z]+)-\d+$/;
const iso = (ms: number) => new Date(ms).toISOString();
const isCancelled = (order: { machine: OrderMachineState }) => order.machine.value === "cancelled";
const isTerminal = (status: OrderStatus | null) => status !== null && TERMINAL_ORDER_STATUSES.includes(status);
type UpdateInput = {
  type: OrderUpdateType;
  unitIndex?: number | null;
  simTime: number;
  message: string;
  factoryEvent?: { id: number; type: string } | null;
  data?: Record<string, string | number | boolean | null>;
  source?: "simulated" | "forecast";
};

export class OrderDesk {
  private state: DeskState;
  private readonly listeners = new Set<(update: OrderUpdate) => void>();
  private reforecastInFlight = false;
  private readonly options: DeskOptions & {
    quoteTtlMs: number;
    maxActiveAgentOrders: number;
    deliveryTimeScale: number;
    reforecastIntervalMs: number;
  };

  constructor(options: DeskOptions, state?: DeskState) {
    this.options = {
      ...options,
      quoteTtlMs: options.quoteTtlMs ?? QUOTE_TTL_MS,
      maxActiveAgentOrders: options.maxActiveAgentOrders ?? FLOOR_MAX_ACTIVE_AGENT_ORDERS,
      deliveryTimeScale: options.deliveryTimeScale ?? 1,
      reforecastIntervalMs: options.reforecastIntervalMs ?? 30_000,
    };
    if (state) {
      if (state.formatVersion !== 1) throw new Error("Unsupported desk state version");
      this.state = structuredClone(state);
      return;
    }
    if (!options.floor) throw new Error("A new desk needs a floor");
    this.state = OrderDesk.initialState(options.floor.snapshot());
  }

  /** Fresh desk state observing a floor snapshot (live start or archive checkpoint). */
  static initialState(snapshot: FactorySnapshot): DeskState {
    return {
      formatVersion: 1,
      seq: 0,
      updates: [],
      quotes: {},
      orders: {},
      placementSeq: 0,
      idempotency: {},
      bridge: createBridgeState(snapshot),
      intakePaused: false,
      prunedTerminal: 0,
      reforecastPending: false,
      lastReforecastAt: 0,
      simTime: snapshot.time,
    };
  }

  serialize(): DeskState {
    return structuredClone(this.state);
  }
  onUpdate(listener: (update: OrderUpdate) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  get intakePaused() {
    return this.state.intakePaused;
  }
  setIntakePaused(paused: boolean) {
    this.state.intakePaused = paused;
  }
  get lastSeq() {
    return this.state.seq;
  }

  private floor(): FloorPort {
    if (!this.options.floor) throw new OrderDeskError("FLOOR_UNAVAILABLE", "The order floor is not running.", true);
    return this.options.floor;
  }
  private newId(prefix: "ao" | "aq") {
    const make = this.options.randomId ?? randomDeskId;
    for (let i = 0; i < 20; i++) {
      const id = make(prefix);
      if (!this.state.orders[id] && !this.state.quotes[id]) return id;
    }
    throw new Error("Could not allocate a unique id");
  }
  private toWall(simTime: number | null, clock: { time: number; speed: number; running: boolean }) {
    if (simTime === null || !clock.running) return null;
    return iso(this.options.now() + ((simTime - clock.time) / Math.max(1, clock.speed)) * 1000);
  }
  private status(order: OrderRecord): OrderStatus {
    return aggregateStatus(order.machine, order.units.map((u) => u.state));
  }
  private activeOrders(agentId?: string) {
    return Object.values(this.state.orders).filter((o) => (!agentId || o.agentId === agentId) && !isTerminal(this.status(o)));
  }
  private ownedOrder(agent: AgentIdentity, orderId: string) {
    const order = this.state.orders[orderId];
    // Another agent's id returns ORDER_NOT_FOUND, not FORBIDDEN, to avoid enumeration.
    if (!order || order.agentId !== agent.id) throw new OrderDeskError("ORDER_NOT_FOUND", `Order ${orderId} was not found.`);
    return order;
  }
  private stepUnit(unit: UnitRecord, event: UnitEvent) {
    const result = unitTransition(unit.state, event);
    unit.state = result.value;
    return result.changed;
  }
  private stepOrder(order: OrderRecord, event: OrderEvent) {
    const result = orderTransition(order.machine, event);
    order.machine = result.state;
    return result.changed;
  }

  private pushUpdate(order: OrderRecord, update: UpdateInput) {
    const status = this.status(order);
    const seq = ++this.state.seq;
    const value: OrderUpdate = {
      seq,
      orderId: order.orderId,
      unitIndex: update.unitIndex ?? null,
      type: update.type,
      status,
      previousStatus: order.lastStatus,
      at: iso(this.options.now()),
      simTime: update.simTime,
      message: update.message.slice(0, 300),
      factoryEvent: update.factoryEvent ?? null,
      ...(update.data ? { data: update.data } : {}),
      source: update.source ?? "simulated",
    };
    order.lastStatus = status;
    order.lastUpdateSeq = seq;
    if (isTerminal(status) && order.terminalAt === null) order.terminalAt = this.options.now();
    const log = this.state.updates;
    log.push(value);
    let perOrder = 0;
    for (const u of log) if (u.orderId === order.orderId) perOrder++;
    if (perOrder > UPDATE_LOG_PER_ORDER) this.drop(log.find((u) => u.orderId === order.orderId)!);
    while (log.length > UPDATE_LOG_LIMIT) this.drop(log[0]);
    // Logs carry ids, update types and simulation time only: never keys or free text.
    this.options.logger?.info({ agentId: order.agentId, orderId: order.orderId, update: value.type, simTime: value.simTime }, "order update");
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(value));
      } catch {
        // A failing subscriber (webhook, MCP stream) must never break the desk.
      }
    }
  }
  private drop(update: OrderUpdate) {
    const index = this.state.updates.indexOf(update);
    if (index >= 0) this.state.updates.splice(index, 1);
    const order = this.state.orders[update.orderId];
    if (order) order.droppedThrough = Math.max(order.droppedThrough, update.seq);
  }

  // ---------------------------------------------------------------- floor status
  floorStatus() {
    const snapshot = this.floor().snapshot();
    return {
      running: snapshot.running,
      simTime: snapshot.time,
      speed: snapshot.speed,
      intakePaused: this.state.intakePaused,
      faults: { ...snapshot.faults },
      stations: Object.fromEntries(LINE_IDS.map((line) => [line, snapshot.stations[line].status])) as Record<LineId, string>,
      activeAgentOrders: this.activeOrders().length,
      throughputPerHour: Math.round(snapshot.metrics.throughput * 100) / 100,
      source: "simulated" as const,
    };
  }

  // ---------------------------------------------------------------- quotes
  async quote(
    agent: AgentIdentity,
    input: QuoteVehicleInput,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<QuoteVehicleOutput> {
    const floor = this.floor();
    const snapshot = floor.snapshot();
    const run = floor.exportRun();
    const issues = checkFeasibility({
      config: input.config,
      quantity: input.quantity,
      destinationZone: input.destinationZone,
      snapshot,
      agentActiveOrders: this.activeOrders(agent.id).length,
      agentMaxActiveOrders: agent.maxActiveOrders,
      floorActiveAgentOrders: this.activeOrders().length,
      floorMaxActiveAgentOrders: this.options.maxActiveAgentOrders,
      intakePaused: this.state.intakePaused,
    });
    const manufacturable = !hasErrors(issues);
    const zone = isZone(input.destinationZone) ? input.destinationZone : null;
    const model = findModel(input.config.modelId);
    const options = model ? resolvedOptions(model, input.config.options) : { ...input.config.options };
    const transit = zone ? nominalTransitSeconds(zone, this.options.deliveryTimeScale) : 0;
    const warnings = issues.some((i) => i.severity === "warning");
    const leadOptions: LeadOptionQuote[] = [];
    const requested = [...new Set(input.leadOptions)];
    for (const [index, name] of requested.entries()) {
      const priority = LEAD_OPTION_PRIORITY[name];
      let shipBy: number | null = null;
      let completeBy: number | null = null;
      let reachedHorizon = !manufacturable;
      if (manufacturable) {
        if (!this.options.forecaster) throw new OrderDeskError("FLOOR_UNAVAILABLE", "Forecasting is unavailable.", true);
        onProgress?.(index / requested.length, `Forecasting ${name} lead time on a forked floor.`);
        const result = await this.options.forecaster(run, {
          probe: { quantity: input.quantity, priority },
          track: [],
          stepSeconds: floor.stepSeconds,
          horizonSeconds: FORECAST_HORIZON_SECONDS,
        });
        shipBy = result.probe?.shipBySimTime ?? null;
        completeBy = result.probe?.completeBySimTime ?? null;
        reachedHorizon = result.probe?.reachedHorizon ?? true;
        if (reachedHorizon)
          issues.push({
            code: "FORECAST_HORIZON_EXCEEDED",
            severity: "warning",
            featureRef: `leadOptions.${name}`,
            measured: null,
            limit: FORECAST_HORIZON_SECONDS,
            unit: "s",
            message: `The forked run did not ship every unit within ${FORECAST_HORIZON_SECONDS} simulated seconds.`,
            suggestion: "Lead time is unknown; retry after current disruptions clear or reduce quantity.",
          });
      }
      const deliverBy = shipBy === null || !zone ? null : shipBy + transit;
      leadOptions.push({
        name,
        productionPriority: priority,
        completeBySimTime: completeBy,
        shipBySimTime: shipBy,
        deliverBySimTime: deliverBy,
        estimatedDeliveryAt: this.toWall(deliverBy, snapshot),
        maxCarrierDelayFactor: MAX_CARRIER_DELAY_FACTOR,
        price: leadOptionPrice(input.config.modelId, input.quantity, zone, name),
        source: "forecast",
        confidence: reachedHorizon ? "unknown" : warnings ? "at-risk" : "firm-if-no-new-inputs",
      });
    }
    onProgress?.(1, "Quote ready.");
    const now = this.options.now();
    const quoteId = this.newId("aq");
    const output: QuoteVehicleOutput = {
      quoteId,
      status: "quoted",
      expiresAt: iso(now + this.options.quoteTtlMs),
      feasibility: { manufacturable, issues },
      lines: priceLines(input.config.modelId, input.quantity, zone),
      leadOptions,
      basis: {
        floorId: FLOOR_ID,
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        simTime: snapshot.time,
        basisHash: basisHash(run),
        priceBookVersion: PRICE_BOOK.id,
        forecastHorizonSeconds: FORECAST_HORIZON_SECONDS,
      },
      virtual: true,
      disclaimer: VIRTUAL_DISCLAIMER,
    };
    this.state.quotes[quoteId] = {
      quoteId,
      agentId: agent.id,
      createdAt: now,
      expiresAt: now + this.options.quoteTtlMs,
      epoch: snapshot.epoch,
      manufacturable,
      config: { modelId: input.config.modelId, options },
      quantity: input.quantity,
      zone,
      leadOptions,
      issues,
      convertedTo: null,
      output,
    };
    this.prune();
    return structuredClone(output);
  }

  // ---------------------------------------------------------------- placement
  placeOrder(agent: AgentIdentity, input: PlaceOrderInput): { order: OrderView; replayed: boolean } {
    const fingerprint = JSON.stringify({ quoteId: input.quoteId, leadOption: input.leadOption, agentReference: input.agentReference ?? null });
    const replay = this.checkIdempotency(agent, input.idempotencyKey, "place", fingerprint);
    if (replay) return { order: this.view(this.state.orders[replay.orderId]), replayed: true };
    const floor = this.floor();
    const quote = this.state.quotes[input.quoteId];
    if (!quote || quote.agentId !== agent.id) throw new OrderDeskError("QUOTE_NOT_FOUND", `Quote ${input.quoteId} was not found.`);
    if (quote.convertedTo) throw new OrderDeskError("QUOTE_EXPIRED", "This quote was already converted into an order; request a new quote.");
    const now = this.options.now();
    if (now > quote.expiresAt) throw new OrderDeskError("QUOTE_EXPIRED", "This quote has expired; request a new quote.");
    const snapshot = floor.snapshot();
    if (snapshot.epoch !== quote.epoch)
      throw new OrderDeskError("QUOTE_EXPIRED", "The order floor changed epoch since this quote; request a new quote.");
    if (this.state.intakePaused)
      throw new OrderDeskError("ORDER_DESK_PAUSED", "The operator has paused order intake.", true, { retryAfterSeconds: 60 });
    if (!quote.manufacturable || !quote.zone)
      throw new OrderDeskError("QUOTE_INFEASIBLE", "This quote is not manufacturable.", false, { issues: quote.issues });
    const lead = quote.leadOptions.find((option) => option.name === input.leadOption);
    if (!lead) throw new OrderDeskError("VALIDATION_FAILED", `Lead option ${input.leadOption} was not quoted; quote it first.`);
    // Placement re-runs feasibility; it does not re-price.
    const errors = checkFeasibility({
      config: { modelId: quote.config.modelId, options: quote.config.options },
      quantity: quote.quantity,
      destinationZone: quote.zone,
      snapshot,
      agentActiveOrders: this.activeOrders(agent.id).length,
      agentMaxActiveOrders: agent.maxActiveOrders,
      floorActiveAgentOrders: this.activeOrders().length,
      floorMaxActiveAgentOrders: this.options.maxActiveAgentOrders,
      intakePaused: false,
    }).filter((i) => i.severity === "error");
    if (errors.some((i) => i.code === "AGENT_ORDER_CAP"))
      throw new OrderDeskError("AGENT_ORDER_CAP", "This agent already has the maximum number of non-terminal orders.", true, { issues: errors, retryAfterSeconds: 60 });
    if (errors.some((i) => i.code === "FLOOR_ORDER_SLOTS_FULL"))
      throw new OrderDeskError("FLOOR_FULL", "The order floor has no free order slots right now.", true, { issues: errors, retryAfterSeconds: 60 });
    if (errors.length) throw new OrderDeskError("QUOTE_INFEASIBLE", "The quoted configuration is no longer feasible.", false, { issues: errors });
    const orderId = this.newId("ao");
    const intake: IntakeOrder = {
      orderId,
      agentId: agent.id,
      agentLabel: agent.label,
      quoteId: quote.quoteId,
      config: structuredClone(quote.config),
      quantity: quote.quantity,
      zone: quote.zone,
      leadOption: input.leadOption,
      priority: lead.productionPriority,
      price: lead.price,
      agentReference: input.agentReference ?? null,
      promised: {
        completeBySimTime: lead.completeBySimTime,
        shipBySimTime: lead.shipBySimTime,
        deliverBySimTime: lead.deliverBySimTime,
        estimatedDeliveryAt: lead.estimatedDeliveryAt,
      },
      confidence: lead.confidence,
    };
    quote.convertedTo = orderId;
    this.state.idempotency[`${agent.id}\u0000${input.idempotencyKey}`] = { kind: "place", fingerprint, orderId, createdAt: now };
    this.options.record?.({ kind: "intake", action: "place", simTime: snapshot.time, order: intake });
    this.applyIntake(intake, snapshot.time);
    const result = floor.command({ id: `desk-create-${orderId}`, type: "order-agent-create", value: `${intake.quantity}:${intake.priority}:${orderId}` });
    if (!result.ok) this.injectionFailed(orderId, snapshot.time, result.message);
    this.state.reforecastPending = true;
    return { order: this.view(this.state.orders[orderId]), replayed: false };
  }

  /** Shared by live placement and archive rebuild: creates the record and the placed/accepted updates. */
  applyIntake(intake: IntakeOrder, simTime: number) {
    this.flushCarrier(simTime);
    const now = this.options.now();
    const { confidence, ...rest } = structuredClone(intake);
    const order: OrderRecord = {
      ...rest,
      placedAt: iso(now),
      placedAtWall: now,
      placedAtSimTime: simTime,
      placementSeq: ++this.state.placementSeq,
      factoryOrderId: null,
      machine: initialOrderState(intake.quantity),
      units: Array.from({ length: intake.quantity }, (_, index) => ({
        index,
        state: initialUnitState(),
        vehicleId: null,
        modules: {},
        carrier: null,
        passedAt: null,
        shippedAt: null,
        deliveredAt: null,
      })),
      atRisk: [],
      latestEstimate: { ...structuredClone(intake.promised), confidence },
      lastStatus: null,
      lastUpdateSeq: 0,
      completedNotified: false,
      droppedThrough: 0,
      terminalAt: null,
    };
    this.state.orders[order.orderId] = order;
    this.pushUpdate(order, {
      type: "order.placed",
      simTime,
      message: `Virtual order for ${order.quantity} robotaxi${order.quantity > 1 ? "s" : ""} placed (${order.leadOption}, ${order.zone}).`,
      data: { quoteId: order.quoteId, leadOption: order.leadOption, zone: order.zone },
    });
    this.stepOrder(order, { type: "DESK_ACCEPTED" });
    this.pushUpdate(order, { type: "order.accepted", simTime, message: "Quote, caps and floor epoch re-checked; injecting the order into the factory." });
    if (this.state.bridge.risks.length) {
      order.atRisk = [...this.state.bridge.risks].sort().slice(0, 10);
      this.pushUpdate(order, { type: "order.at_risk", simTime, message: `Order is at risk: ${order.atRisk.join(", ")}.`, data: { reasons: order.atRisk.join(",") } });
    }
  }

  /** The engine refused order-agent-create (for example the 20-order engine cap was hit). */
  injectionFailed(orderId: string, simTime: number, message: string) {
    const order = this.state.orders[orderId];
    if (!order || order.machine.value !== "accepted") return;
    this.stepOrder(order, { type: "INJECTION_FAILED" });
    this.pushUpdate(order, { type: "order.failed", simTime, message: `The factory refused the order: ${message}`, data: { reason: "injection_rejected" } });
  }

  private checkIdempotency(agent: AgentIdentity, key: string, kind: "place" | "cancel", fingerprint: string) {
    const existing = this.state.idempotency[`${agent.id}\u0000${key}`];
    if (!existing) return null;
    if (existing.kind !== kind || existing.fingerprint !== fingerprint)
      throw new OrderDeskError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with a different request.");
    if (!this.state.orders[existing.orderId]) throw new OrderDeskError("ORDER_NOT_FOUND", "The original order is no longer retained.");
    return existing;
  }

  // ---------------------------------------------------------------- cancellation
  cancelOrder(agent: AgentIdentity, input: CancelOrderInput): { order: OrderView; cancelled: boolean; replayed: boolean } {
    const fingerprint = JSON.stringify({ orderId: input.orderId });
    const replay = this.checkIdempotency(agent, input.idempotencyKey, "cancel", fingerprint);
    const order = this.ownedOrder(agent, input.orderId);
    if (replay) return { order: this.view(order), cancelled: isCancelled(order), replayed: true };
    if (order.machine.value === "cancelled") return { order: this.view(order), cancelled: true, replayed: false };
    const status = this.status(order);
    if (isTerminal(status)) throw new OrderDeskError("CANCEL_NOT_ALLOWED", `Order is ${status}; it can no longer be cancelled.`);
    const committed = order.units.find((u) => u.vehicleId);
    if (committed)
      throw new OrderDeskError(
        "CANCEL_NOT_ALLOWED",
        `A unit is already committed to final assembly as vehicle ${committed.vehicleId}; cancellation is no longer possible.`,
      );
    const floor = this.floor();
    const snapshot = floor.snapshot();
    this.state.idempotency[`${agent.id}\u0000${input.idempotencyKey}`] = { kind: "cancel", fingerprint, orderId: order.orderId, createdAt: this.options.now() };
    this.options.record?.({ kind: "intake", action: "cancel", simTime: snapshot.time, orderId: order.orderId });
    this.applyCancelRequest(order.orderId, snapshot.time);
    if (order.machine.value === "cancelling") {
      const result = floor.command({ id: `desk-cancel-${order.orderId}`, type: "order-cancel", value: order.factoryOrderId! });
      if (!result.ok) {
        this.stepOrder(order, { type: "CANCEL_REJECTED" });
        throw new OrderDeskError("CANCEL_NOT_ALLOWED", result.message);
      }
    }
    this.state.reforecastPending = true;
    return { order: this.view(order), cancelled: isCancelled(order), replayed: false };
  }

  /** Marks the agent's cancel request; the engine's order-cancelled event confirms it. */
  applyCancelRequest(orderId: string, simTime: number) {
    this.flushCarrier(simTime);
    const order = this.state.orders[orderId];
    if (!order) return;
    const before = order.machine.value;
    this.stepOrder(order, { type: "CANCEL_REQUESTED", by: "agent" });
    if (before !== "cancelled" && order.machine.value === "cancelled")
      this.pushUpdate(order, { type: "order.cancelled", simTime, message: "Order cancelled before reaching the factory.", data: { reason: "agent_requested" } });
  }

  // ---------------------------------------------------------------- factory events
  /** Feed one ordered AuditEntry from the floor (live subscription or archive rebuild). */
  ingest(entry: AuditEntry) {
    const time =
      entry.kind === "event"
        ? entry.event.time
        : entry.kind === "command"
          ? entry.time
          : typeof entry.lineage.dispatchedAt === "number"
            ? entry.lineage.dispatchedAt
            : this.state.simTime;
    this.flushCarrier(time);
    if (entry.kind === "command" && !entry.result.ok) this.deskCommandRefused(entry.command.id, entry.time, entry.result.message);
    const { state, signals, lineage } = bridgeReduce(this.state.bridge, entry);
    this.state.bridge = state;
    for (const signal of signals) this.applySignal(signal);
    if (lineage) this.applyLineage(lineage);
  }

  /** Desk-issued engine commands that the engine refused; handled here so live and archive rebuild agree. */
  private deskCommandRefused(commandId: string, simTime: number, message: string) {
    const create = /^desk-create-(ao-[a-z0-9]+)$/.exec(commandId);
    if (create) return this.injectionFailed(create[1], simTime, message);
    const cancel = /^desk-cancel-(ao-[a-z0-9]+)$/.exec(commandId);
    const order = cancel ? this.state.orders[cancel[1]] : undefined;
    if (order) this.stepOrder(order, { type: "CANCEL_REJECTED" });
  }

  private unitByVehicle(order: OrderRecord, vehicleId: string) {
    return order.units.find((u) => u.vehicleId === vehicleId) ?? null;
  }

  private applySignal(signal: BridgeSignal) {
    const fe = signal.factoryEvent;
    const time = signal.time;
    if (signal.type === "RISK_RAISED" || signal.type === "RISK_CLEARED") {
      this.refreshRisk(time, fe, signal.type === "RISK_RAISED" ? signal.reason : null);
      this.state.reforecastPending = true;
      return;
    }
    if (signal.type === "FLOOR_RESET") {
      for (const order of this.activeOrders()) {
        this.stepOrder(order, { type: "FAIL", reason: "floor_reset" });
        this.pushUpdate(order, { type: "order.failed", simTime: time, message: "The order floor was reset while this order was active.", factoryEvent: fe, data: { reason: "floor_reset" } });
      }
      return;
    }
    const order = this.state.orders[signal.ref];
    if (!order || isOrderFinal(order.machine)) return;
    switch (signal.type) {
      case "FACTORY_ORDER_CREATED":
        order.factoryOrderId = signal.factoryOrderId;
        if (this.stepOrder(order, { type: "FACTORY_ORDER_CREATED" }))
          this.pushUpdate(order, { type: "order.scheduled", simTime: time, message: `Scheduled as factory production order ${signal.factoryOrderId}.`, factoryEvent: fe, data: { factoryOrderId: signal.factoryOrderId } });
        break;
      case "QUEUE_HEAD":
      case "QUEUE_DEMOTED": {
        let changed = false;
        for (const unit of order.units.filter((u) => !u.vehicleId)) changed = this.stepUnit(unit, { type: signal.type }) || changed;
        if (changed)
          this.pushUpdate(
            order,
            signal.type === "QUEUE_HEAD"
              ? { type: "unit.queue_head", simTime: time, message: "Next in line for final assembly; module progress is projected until joining.", factoryEvent: fe }
              : { type: "unit.queue_demoted", simTime: time, message: "A higher-priority order moved ahead; back in the queue.", factoryEvent: fe },
          );
        break;
      }
      case "UNIT_COMMITTED": {
        const unit = order.units.find((u) => !u.vehicleId);
        if (!unit) break;
        unit.vehicleId = signal.vehicleId;
        signal.modules.forEach((id, i) => {
          const line = MODULE_LINE.exec(id)?.[1] as LineId | undefined;
          if (line && LINE_IDS.includes(line)) unit.modules[line] = { id, lot: signal.lots[i] ?? "", reworkHistory: [] };
        });
        this.stepUnit(unit, { type: "UNIT_COMMITTED" });
        this.stepOrder(order, { type: "UNIT_COMMITTED" });
        this.pushUpdate(order, { type: "unit.committed", unitIndex: unit.index, simTime: time, message: `Five accepted modules reserved for vehicle ${signal.vehicleId}; joining started.`, factoryEvent: fe, data: { vehicleId: signal.vehicleId } });
        break;
      }
      case "UNIT_JOINED":
      case "UNIT_REWORK":
      case "UNIT_PASSED":
      case "UNIT_STAGING":
      case "UNIT_PARKED":
      case "UNIT_DISPATCH_STARTED":
      case "UNIT_SHIPPED": {
        const unit = this.unitByVehicle(order, signal.vehicleId);
        if (!unit || !this.stepUnit(unit, { type: signal.type })) break;
        const vehicle = signal.vehicleId;
        const base = { unitIndex: unit.index, simTime: time, factoryEvent: fe, data: { vehicleId: vehicle } };
        if (signal.type === "UNIT_JOINED") this.pushUpdate(order, { ...base, type: "unit.joined", message: `Vehicle ${vehicle} joined; end-of-line test started.` });
        else if (signal.type === "UNIT_REWORK")
          this.pushUpdate(order, { ...base, type: "unit.rework", message: `End-of-line check requires adjustment on ${vehicle}.`, data: { vehicleId: vehicle, defectClass: signal.defectClass } });
        else if (signal.type === "UNIT_PASSED") {
          unit.passedAt = time;
          this.pushUpdate(order, { ...base, type: "unit.passed", message: `Vehicle ${vehicle} passed end-of-line checks.` });
          if (!order.completedNotified && order.units.every((u) => u.passedAt !== null)) {
            order.completedNotified = true;
            this.pushUpdate(order, { type: "order.completed", simTime: time, factoryEvent: fe, message: "Every unit passed end-of-line inspection." });
          }
        } else if (signal.type === "UNIT_STAGING") this.pushUpdate(order, { ...base, type: "unit.staging", message: `Vehicle ${vehicle} is on the shared road to parking.` });
        else if (signal.type === "UNIT_PARKED") this.pushUpdate(order, { ...base, type: "unit.parked", message: `Vehicle ${vehicle} is parked and ready for pickup.` });
        else if (signal.type === "UNIT_DISPATCH_STARTED") this.pushUpdate(order, { ...base, type: "unit.dispatch_started", message: `Vehicle ${vehicle} is driving to the customer exit.` });
        else {
          unit.shippedAt = time;
          unit.carrier = createCarrierPlan({
            seed: this.options.floor?.seed ?? this.carrierSeed,
            orderId: order.orderId,
            unitIndex: unit.index,
            zone: order.zone,
            shippedAt: time,
            timeScale: this.options.deliveryTimeScale,
          });
          this.pushUpdate(order, {
            ...base,
            type: "unit.shipped",
            message: `Vehicle ${vehicle} crossed the customer exit; Brickworks Virtual Freight has custody (${unit.carrier.trackingId}).`,
            data: { vehicleId: vehicle, trackingId: unit.carrier.trackingId },
          });
          this.refreshDeliveryEstimate(order);
          if (order.atRisk.length && order.units.every((u) => u.shippedAt !== null)) {
            order.atRisk = [];
            this.pushUpdate(order, { type: "order.risk_cleared", simTime: time, factoryEvent: fe, message: "All units shipped; factory disruptions no longer affect this order.", data: { reason: "shipped" } });
          }
        }
        break;
      }
      case "CANCEL_CONFIRMED": {
        const before = order.machine.value;
        if (this.stepOrder(order, { type: "CANCEL_CONFIRMED" }))
          this.pushUpdate(order, {
            type: "order.cancelled",
            simTime: time,
            factoryEvent: fe,
            message: before === "cancelling" ? "Cancellation confirmed by the factory; no unit was committed." : "Cancelled by the floor operator before any unit was committed.",
            data: { reason: order.machine.context.reason },
          });
        break;
      }
      case "FACTORY_ORDER_RETIRED":
        break;
    }
  }

  /** Seed used when rebuilding without a live floor; set from the archived checkpoint. */
  carrierSeed = 42;

  private applyLineage(lineage: LineageSignal) {
    const order = this.state.orders[lineage.ref];
    const unit = order ? this.unitByVehicle(order, lineage.vehicleId) : null;
    if (!unit) return;
    for (const module of lineage.modules) {
      const slot = unit.modules[module.line];
      if (slot && slot.id === module.id) slot.reworkHistory = ((module.reworkHistory ?? []) as ModuleReworkEvent[]).slice(0, 4);
    }
  }

  private refreshRisk(time: number, fe: { id: number; type: string }, raised: string | null) {
    const reasons = [...this.state.bridge.risks].sort().slice(0, 10);
    for (const order of this.activeOrders()) {
      if (order.units.every((u) => u.shippedAt !== null)) continue;
      const before = order.atRisk;
      order.atRisk = reasons;
      if (raised && !before.includes(raised))
        this.pushUpdate(order, { type: "order.at_risk", simTime: time, factoryEvent: fe, message: `Order is at risk: ${reasons.join(", ")}.`, data: { reason: raised, reasons: reasons.join(",") } });
      else if (!reasons.length && before.length)
        this.pushUpdate(order, { type: "order.risk_cleared", simTime: time, factoryEvent: fe, message: "Factory disruptions affecting this order have cleared." });
    }
  }

  // ---------------------------------------------------------------- carrier clock
  /** Advance desk time to the floor clock: emits every carrier event due at or before simTime. */
  advanceClock(simTime: number) {
    this.flushCarrier(simTime);
  }

  /** Emits due carrier events across all plans strictly in simulated-time order. */
  private flushCarrier(time: number) {
    this.state.simTime = Math.max(this.state.simTime, time);
    for (;;) {
      let best: { order: OrderRecord; unit: UnitRecord; time: number } | null = null;
      for (const order of Object.values(this.state.orders)) {
        if (isOrderFinal(order.machine)) continue;
        for (const unit of order.units) {
          if (!unit.carrier) continue;
          const next = nextCarrierEventTime(unit.carrier);
          if (next !== null && next <= time + 1e-9 && (!best || next < best.time - 1e-12)) best = { order, unit, time: next };
        }
      }
      if (!best) return;
      const event = popNextCarrierEvent(best.unit.carrier!, time);
      if (!event) return;
      this.applyCarrierEvent(best.order, best.unit, event);
    }
  }

  private applyCarrierEvent(order: OrderRecord, unit: UnitRecord, event: CarrierEvent) {
    const plan = unit.carrier!;
    const leg = plan.legs[event.leg];
    const data = { trackingId: plan.trackingId, leg: event.leg, carrierEvent: `${plan.trackingId}:${event.leg}:${event.kind}` };
    const base = { unitIndex: unit.index, simTime: event.time, data };
    switch (event.kind) {
      case "departed_hub":
        this.stepUnit(unit, { type: "CARRIER_DEPARTED" });
        this.pushUpdate(order, { ...base, type: "carrier.departed_hub", message: `Departed ${leg.from} for ${leg.to}.` });
        break;
      case "arrived_hub":
        this.pushUpdate(order, { ...base, type: "carrier.arrived_hub", message: `Arrived at ${leg.to}.` });
        break;
      case "delayed":
        this.stepUnit(unit, { type: "CARRIER_DELAYED" });
        this.pushUpdate(order, { ...base, type: "carrier.delayed", message: `Leg to ${leg.to} delayed (${event.reason}).`, data: { ...data, reason: event.reason ?? null } });
        break;
      case "recovered":
        this.stepUnit(unit, { type: "CARRIER_RECOVERED" });
        this.pushUpdate(order, { ...base, type: "carrier.recovered", message: `Delay on the leg to ${leg.to} recovered.` });
        break;
      case "out_for_delivery":
        this.stepUnit(unit, { type: "CARRIER_OUT_FOR_DELIVERY" });
        this.pushUpdate(order, { ...base, type: "carrier.out_for_delivery", message: `Out for delivery from ${leg.from}.` });
        break;
      case "delivered":
        unit.deliveredAt = event.time;
        this.stepUnit(unit, { type: "CARRIER_DELIVERED" });
        this.pushUpdate(order, { ...base, type: "unit.delivered", message: `Delivered to ${leg.to} (virtual).` });
        if (order.units.every((u) => unitKey(u.state) === "delivered")) {
          this.stepOrder(order, { type: "ALL_UNITS_DELIVERED" });
          this.pushUpdate(order, { type: "order.delivered", simTime: event.time, message: "Every unit delivered. Virtual order complete." });
        }
        break;
    }
  }

  private refreshDeliveryEstimate(order: OrderRecord) {
    const etas = order.units.map((u) => (u.carrier ? etaSimTime(u.carrier) : null));
    if (!etas.every((eta) => eta !== null)) return;
    order.latestEstimate = {
      ...order.latestEstimate,
      shipBySimTime: Math.max(...order.units.map((u) => u.shippedAt ?? 0)),
      deliverBySimTime: Math.max(...(etas as number[])),
    };
  }

  // ---------------------------------------------------------------- operator and test carrier controls
  carrierControl(action: CarrierAction, orderId: string, unitIndex: number) {
    const simTime = this.options.floor ? this.options.floor.snapshot().time : this.state.simTime;
    const order = this.state.orders[orderId];
    const unit = order?.units[unitIndex];
    if (!order || !unit?.carrier || isOrderFinal(order.machine))
      throw new OrderDeskError("ORDER_NOT_FOUND", "No unit in carrier custody matches that order and unit.");
    this.options.record?.({ kind: "desk-action", action, simTime, orderId, unitIndex });
    return this.applyCarrierControl(action, orderId, unitIndex, simTime);
  }

  applyCarrierControl(action: CarrierAction, orderId: string, unitIndex: number, simTime: number) {
    this.flushCarrier(simTime);
    const order = this.state.orders[orderId];
    const unit = order?.units[unitIndex];
    if (!order || !unit?.carrier || isOrderFinal(order.machine)) return false;
    const plan = unit.carrier;
    const data = { trackingId: plan.trackingId, leg: plan.events.find((e) => !e.emitted)?.leg ?? plan.legs.length - 1 };
    if (action === "carrier-hold") {
      if (!holdCarrier(plan, simTime)) return false;
      this.stepUnit(unit, { type: "CARRIER_DELAYED" });
      this.pushUpdate(order, { type: "carrier.delayed", unitIndex, simTime, message: "Carrier held by the floor operator.", data: { ...data, reason: "virtual-operator-hold" } });
      return true;
    }
    if (action === "carrier-release") {
      const duration = releaseCarrier(plan, simTime);
      if (duration === null) return false;
      this.stepUnit(unit, { type: "CARRIER_RECOVERED" });
      this.pushUpdate(order, { type: "carrier.recovered", unitIndex, simTime, message: `Carrier released after ${Math.round(duration)} simulated seconds on hold.`, data: { ...data, heldSeconds: Math.round(duration * 1000) / 1000 } });
      this.refreshDeliveryEstimate(order);
      return true;
    }
    plan.lost = true;
    this.stepUnit(unit, { type: "CARRIER_LOST" });
    this.stepOrder(order, { type: "FAIL", reason: "carrier_lost" });
    this.pushUpdate(order, { type: "order.failed", unitIndex, simTime, message: "Test injection: the virtual carrier lost this unit.", data: { ...data, reason: "carrier_lost" } });
    return true;
  }

  // ---------------------------------------------------------------- re-forecast
  /** Orders whose units are not all shipped yet and that have a factory order. */
  private forecastable() {
    return this.activeOrders().filter((o) => o.factoryOrderId && o.units.some((u) => u.shippedAt === null));
  }

  needsReforecast() {
    return (
      this.state.reforecastPending &&
      !this.reforecastInFlight &&
      this.options.forecaster !== undefined &&
      this.options.floor !== null &&
      this.options.now() - this.state.lastReforecastAt >= this.options.reforecastIntervalMs &&
      this.forecastable().length > 0
    );
  }

  /** Forks the floor once for every active agent order; emits estimate.revised (source forecast) when ship-by moves. */
  async reforecast(force = false): Promise<number> {
    if (!force && !this.needsReforecast()) return 0;
    if (this.reforecastInFlight || !this.options.forecaster) return 0;
    const floor = this.floor();
    const orders = this.forecastable();
    this.state.reforecastPending = false;
    this.state.lastReforecastAt = this.options.now();
    if (!orders.length) return 0;
    this.reforecastInFlight = true;
    let revised = 0;
    try {
      const snapshot = floor.snapshot();
      const result = await this.options.forecaster(floor.exportRun(), {
        track: orders.map((o) => o.factoryOrderId!),
        stepSeconds: floor.stepSeconds,
        horizonSeconds: FORECAST_HORIZON_SECONDS,
      });
      for (const order of orders) {
        if (isOrderFinal(order.machine)) continue;
        const forecast = result.tracked[order.factoryOrderId!];
        if (!forecast) continue;
        const shipped = order.units.map((u) => u.shippedAt).filter((t): t is number => t !== null);
        const shipBy = forecast.shipBySimTime === null ? null : Math.max(forecast.shipBySimTime, ...shipped);
        const completeBy =
          forecast.completeBySimTime ?? (order.units.every((u) => u.passedAt !== null) ? Math.max(...order.units.map((u) => u.passedAt!)) : null);
        const deliverBy = shipBy === null ? null : shipBy + nominalTransitSeconds(order.zone, this.options.deliveryTimeScale);
        const confidence: LeadOptionQuote["confidence"] = forecast.reachedHorizon ? "unknown" : order.atRisk.length ? "at-risk" : "firm-if-no-new-inputs";
        const previous = order.latestEstimate;
        const moved =
          (previous.shipBySimTime === null) !== (shipBy === null) ||
          (shipBy !== null && previous.shipBySimTime !== null && Math.abs(shipBy - previous.shipBySimTime) >= 1) ||
          previous.confidence !== confidence;
        order.latestEstimate = {
          completeBySimTime: completeBy,
          shipBySimTime: shipBy,
          deliverBySimTime: deliverBy,
          estimatedDeliveryAt: this.toWall(deliverBy, snapshot),
          confidence,
        };
        if (!moved) continue;
        revised++;
        this.pushUpdate(order, {
          type: "estimate.revised",
          simTime: result.basisSimTime,
          source: "forecast",
          message:
            shipBy === null
              ? "Re-forecast could not ship every unit within the forecast horizon; lead time is unknown."
              : `Re-forecast: ship by simulated time ${Math.round(shipBy)}, deliver by ${Math.round(deliverBy!)}.`,
          data: { shipBySimTime: shipBy, deliverBySimTime: deliverBy, confidence },
        });
      }
    } finally {
      this.reforecastInFlight = false;
    }
    return revised;
  }

  // ---------------------------------------------------------------- views
  private stationsFor(order: OrderRecord, unit: UnitRecord, snapshot: FactorySnapshot | null): Record<LineId, StationProgress> {
    const head = unitKey(unit.state) === "modules";
    // Earlier units of the same order that are also unbound draw on the same stock first.
    const ahead = order.units.filter((u) => u.index < unit.index && !u.vehicleId).length;
    const entries = LINE_IDS.map((line): [LineId, StationProgress] => {
      const bound = unit.modules[line];
      if (bound) {
        const history = bound.reworkHistory.slice(0, 4).map((h) => ({
          simTime: h.time,
          event: h.event,
          ...(h.defectClass ? { defectClass: h.defectClass } : {}),
        }));
        return [
          line,
          {
            state: "reserved",
            binding: "bound",
            moduleId: bound.id,
            lot: bound.lot || null,
            rework: bound.reworkHistory.some((h) => h.event === "rework-started") ? 1 : 0,
            history,
          },
        ];
      }
      let state: StationProgress["state"] = "waiting";
      if (head && snapshot) {
        const station = snapshot.stations[line];
        if (snapshot.warehouse[line] > ahead) state = "ready";
        else if (station.current || station.status === "processing") state = "building";
      }
      return [line, { state, binding: "projected", moduleId: null, lot: null, rework: null, history: [] }];
    });
    return Object.fromEntries(entries) as Record<LineId, StationProgress>;
  }

  private wallFor(snapshot: FactorySnapshot | null) {
    return (simTime: number) => (snapshot ? this.toWall(simTime, snapshot) : null);
  }

  private unitView(order: OrderRecord, unit: UnitRecord, snapshot: FactorySnapshot | null): UnitView {
    return {
      index: unit.index,
      status: unitPublicStatus(unit.state),
      stage: unitStage(unit.state),
      vehicleId: unit.vehicleId,
      stations: this.stationsFor(order, unit, snapshot),
      tracking: unit.carrier ? trackingView(unit.carrier, this.wallFor(snapshot)) : null,
    };
  }

  private snapshotOrNull() {
    try {
      return this.options.floor ? this.options.floor.snapshot() : null;
    } catch {
      return null;
    }
  }

  private statusReason(order: OrderRecord) {
    return order.machine.context.reason ?? (order.atRisk.length ? order.atRisk[0] : null);
  }

  private view(order: OrderRecord, snapshot = this.snapshotOrNull()): OrderView {
    const estimateAt = (deliverBy: number | null, fallback: string | null) =>
      deliverBy !== null && snapshot ? this.toWall(deliverBy, snapshot) ?? fallback : fallback;
    return {
      orderId: order.orderId,
      agentId: order.agentId,
      quoteId: order.quoteId,
      status: this.status(order),
      statusReason: this.statusReason(order),
      atRisk: { value: order.atRisk.length > 0, reasons: [...order.atRisk] },
      config: structuredClone(order.config),
      quantity: order.quantity,
      destinationZone: order.zone,
      leadOption: order.leadOption,
      price: { ...order.price },
      agentReference: order.agentReference,
      placedAt: order.placedAt,
      placedAtSimTime: order.placedAtSimTime,
      factoryOrderId: order.factoryOrderId,
      promised: { ...order.promised },
      latestEstimate: {
        ...order.latestEstimate,
        estimatedDeliveryAt: estimateAt(order.latestEstimate.deliverBySimTime, order.latestEstimate.estimatedDeliveryAt),
      },
      units: order.units.map((u) => this.unitView(order, u, snapshot)),
      lastUpdateSeq: order.lastUpdateSeq,
      virtual: true,
      disclaimer: VIRTUAL_DISCLAIMER,
    };
  }

  getOrder(agent: AgentIdentity, orderId: string): OrderView {
    return this.view(this.ownedOrder(agent, orderId));
  }

  ownsOrder(agentId: string, orderId: string) {
    return this.state.orders[orderId]?.agentId === agentId;
  }

  /** Newest first; the cursor is the placement sequence of the last order returned. */
  listOrders(agent: AgentIdentity, input: Partial<ListOrdersInput>): { orders: OrderSummary[]; nextCursor: string | null } {
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    let before = Number.POSITIVE_INFINITY;
    if (input.cursor !== undefined) {
      const match = /^p(\d+)$/.exec(input.cursor);
      if (!match) throw new OrderDeskError("VALIDATION_FAILED", "Malformed cursor.");
      before = Number(match[1]);
    }
    const statuses = input.status?.length ? new Set(input.status) : null;
    const matching = Object.values(this.state.orders)
      .filter((o) => o.agentId === agent.id && o.placementSeq < before && (!statuses || statuses.has(this.status(o))))
      .sort((a, b) => b.placementSeq - a.placementSeq);
    const page = matching.slice(0, limit);
    const snapshot = this.snapshotOrNull();
    return {
      orders: page.map((o) => {
        const view = this.view(o, snapshot);
        return {
          orderId: view.orderId,
          status: view.status,
          quantity: view.quantity,
          leadOption: view.leadOption,
          destinationZone: view.destinationZone,
          placedAt: view.placedAt,
          atRisk: view.atRisk,
          lastUpdateSeq: view.lastUpdateSeq,
          etaAt: view.latestEstimate.estimatedDeliveryAt,
        };
      }),
      nextCursor: matching.length > limit ? `p${page[page.length - 1].placementSeq}` : null,
    };
  }

  // ---------------------------------------------------------------- update feed
  /** Parses a feed cursor; "u<seq>" means "after seq". */
  static parseCursor(cursor: string | undefined) {
    if (cursor === undefined || cursor === "") return 0;
    const match = /^u(\d+)$/.exec(cursor);
    if (!match) throw new OrderDeskError("VALIDATION_FAILED", "Malformed cursor.");
    return Number(match[1]);
  }

  /** Non-blocking page of the caller's updates; long polling lives in the transport layer. */
  updatesFor(agent: AgentIdentity, input: Partial<GetOrderUpdatesInput>): GetOrderUpdatesOutput {
    const after = OrderDesk.parseCursor(input.cursor);
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    if (input.orderId) {
      const order = this.ownedOrder(agent, input.orderId);
      if (after < order.droppedThrough)
        throw new OrderDeskError("CURSOR_EXPIRED", "Updates after this cursor were pruned; call get_order for the current state and resume from its lastUpdateSeq.");
    } else {
      for (const order of Object.values(this.state.orders))
        if (order.agentId === agent.id && after < order.droppedThrough && order.lastUpdateSeq > after)
          throw new OrderDeskError("CURSOR_EXPIRED", "Updates after this cursor were pruned; call list_orders for the current state and resume from the newest lastUpdateSeq.");
    }
    const mine = this.state.updates.filter(
      (u) => u.seq > after && (input.orderId ? u.orderId === input.orderId : this.state.orders[u.orderId]?.agentId === agent.id),
    );
    const page = mine.slice(0, limit);
    const oldest = this.state.updates.find((u) => this.state.orders[u.orderId]?.agentId === agent.id);
    return {
      updates: structuredClone(page),
      nextCursor: `u${page.length ? page[page.length - 1].seq : Math.max(after, this.callerHighWater(agent, input.orderId, after))}`,
      hasMore: mine.length > limit,
      oldestRetainedSeq: oldest?.seq ?? this.state.seq,
    };
  }

  /** With no new updates the cursor stays put, so a caller never skips its own future updates. */
  private callerHighWater(_agent: AgentIdentity, _orderId: string | undefined, after: number) {
    return after;
  }

  /** True when the caller has an update after the cursor (used by long polls and SSE). */
  hasUpdatesAfter(agent: AgentIdentity, after: number, orderId?: string) {
    for (let i = this.state.updates.length - 1; i >= 0; i--) {
      const u = this.state.updates[i];
      if (u.seq <= after) return false;
      if (orderId ? u.orderId === orderId : this.state.orders[u.orderId]?.agentId === agent.id) return true;
    }
    return false;
  }

  /** The newest retained updates of one order, oldest first (resource reads; caller checks ownership). */
  recentUpdates(orderId: string, limit: number) {
    return structuredClone(this.state.updates.filter((u) => u.orderId === orderId).slice(-limit));
  }

  /** Every retained update after a sequence number, regardless of agent (operator and archive use). */
  updatesSince(after: number) {
    return structuredClone(this.state.updates.filter((u) => u.seq > after));
  }

  /**
   * Replay digest of the simulated update log. Wall-clock "at", seq and
   * forecast-sourced updates are excluded because they depend on when the
   * operator looked, not on the seeded run.
   */
  updateLogDigest() {
    const rows = this.state.updates
      .filter((u) => u.source === "simulated")
      .map((u) => [u.orderId, u.unitIndex, u.type, u.status, u.previousStatus, Math.round(u.simTime * 1000) / 1000, u.factoryEvent?.id ?? null, u.data ?? null]);
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }

  // ---------------------------------------------------------------- public floor view
  deskView(): OrderDeskView {
    const snapshot = this.snapshotOrNull();
    const all = Object.values(this.state.orders);
    const counts = { active: 0, delivered: 0, cancelled: 0, failed: 0 };
    for (const order of all) {
      const status = this.status(order);
      if (status === "delivered") counts.delivered++;
      else if (status === "cancelled") counts.cancelled++;
      else if (status === "failed") counts.failed++;
      else counts.active++;
    }
    const shipped = all.filter((o) => o.units.every((u) => u.shippedAt !== null) && o.units.length);
    const quoted = shipped.filter((o) => o.promised.shipBySimTime !== null);
    const actualShip = (o: OrderRecord) => Math.max(...o.units.map((u) => u.shippedAt!)) - o.placedAtSimTime;
    const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
    const cards: DeskOrderCard[] = all
      .sort((a, b) => b.placementSeq - a.placementSeq)
      .slice(0, 50)
      .map((order) => {
        const view = this.view(order, snapshot);
        const recent = this.state.updates.filter((u) => u.orderId === order.orderId).slice(-20);
        const { confidence: _confidence, ...latest } = view.latestEstimate;
        return {
          orderId: order.orderId,
          agentLabel: order.agentLabel.slice(0, 80),
          status: view.status,
          statusReason: view.statusReason,
          atRisk: view.atRisk,
          quantity: order.quantity,
          leadOption: order.leadOption,
          destinationZone: order.zone,
          price: view.price,
          placedAtSimTime: order.placedAtSimTime,
          factoryOrderId: order.factoryOrderId,
          promised: view.promised,
          latestEstimate: latest,
          units: view.units,
          recentUpdates: structuredClone(recent),
        };
      });
    return {
      floorId: FLOOR_ID,
      simTime: snapshot?.time ?? this.state.simTime,
      intakePaused: this.state.intakePaused,
      orders: cards,
      metrics: {
        ...counts,
        meanQuotedShipSeconds: mean(quoted.map((o) => o.promised.shipBySimTime! - o.placedAtSimTime)),
        meanActualShipSeconds: mean(shipped.map(actualShip)),
        onTimeShare: quoted.length
          ? Math.round((quoted.filter((o) => Math.max(...o.units.map((u) => u.shippedAt!)) <= o.promised.shipBySimTime! + 1e-6).length / quoted.length) * 1000) / 1000
          : null,
        source: "simulated",
      },
      virtual: true,
      disclaimer: VIRTUAL_DISCLAIMER,
    };
  }

  hasActiveAgentOrders() {
    return this.activeOrders().length > 0;
  }

  // ---------------------------------------------------------------- restore and housekeeping
  /**
   * After restoring desk state next to a restored floor, fail any active order
   * whose factory order or committed vehicles no longer exist on the floor.
   */
  reconcile(snapshot: FactorySnapshot) {
    let failed = 0;
    const orderIds = new Set(snapshot.orders.map((o) => o.id));
    const vehicleIds = new Set(snapshot.vehicles.map((v) => v.id));
    for (const order of this.activeOrders()) {
      const missingOrder =
        order.factoryOrderId !== null && !orderIds.has(order.factoryOrderId) && order.units.some((u) => !u.vehicleId);
      const missingVehicle = order.units.some((u) => u.vehicleId && u.shippedAt === null && !vehicleIds.has(u.vehicleId));
      if (!missingOrder && !missingVehicle) continue;
      this.stepOrder(order, { type: "FAIL", reason: "floor_state_lost" });
      this.pushUpdate(order, { type: "order.failed", simTime: snapshot.time, message: "The floor state for this order was lost during restore.", data: { reason: "floor_state_lost" } });
      failed++;
    }
    this.state.simTime = Math.max(this.state.simTime, snapshot.time);
    return failed;
  }

  /** Drops expired quotes, stale idempotency keys and terminal orders past retention. */
  prune() {
    const now = this.options.now();
    for (const [id, quote] of Object.entries(this.state.quotes))
      if (now > quote.expiresAt + this.options.quoteTtlMs) delete this.state.quotes[id];
    for (const [key, record] of Object.entries(this.state.idempotency))
      if (now - record.createdAt > IDEMPOTENCY_RETENTION_MS) delete this.state.idempotency[key];
    for (const [id, order] of Object.entries(this.state.orders)) {
      if (order.terminalAt === null || now - order.terminalAt <= TERMINAL_RETENTION_MS) continue;
      delete this.state.orders[id];
      this.state.updates = this.state.updates.filter((u) => u.orderId !== id);
      this.state.prunedTerminal++;
    }
  }

  /** Short, key-free description for operator logs and the floor archive. */
  orderBrief(orderId: string) {
    const order = this.state.orders[orderId];
    if (!order) return null;
    return { orderId, agentId: order.agentId, status: this.status(order), factoryOrderId: order.factoryOrderId, quantity: order.quantity };
  }
}
