import { z } from "zod";
import { LINE_IDS } from "./index.ts";

/**
 * DF-ORDER-001 order desk contracts. One set of Zod schemas is shared by the
 * MCP tools, the REST mirror, the OpenAPI document, the web client and tests.
 * Everything here describes a virtual order: no money, no shipping, no PII.
 */

// ---------- shared ----------
export const VIRTUAL_DISCLAIMER =
  "Virtual order in the Brickworks simulation. No payment, no physical vehicle, no shipment.";
export const VIRTUAL_CURRENCY = "BWC-VIRTUAL" as const;
export const FLOOR_ID = "order-floor" as const;
export const valueSource = z.enum(["declared", "simulated", "forecast"]);
export const ORDER_STATUSES = [
  "placed",
  "accepted",
  "scheduled",
  "in_production",
  "quality_check",
  "completed",
  "ready_for_pickup",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "failed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "delivered",
  "cancelled",
  "failed",
];
export const orderStatus = z.enum(ORDER_STATUSES);
export const DESTINATION_ZONES = [
  "zone-local",
  "zone-metro",
  "zone-regional",
  "zone-remote",
] as const;
export type DestinationZone = (typeof DESTINATION_ZONES)[number];
export const LEAD_OPTIONS = ["standard", "expedite"] as const;
export type LeadOption = (typeof LEAD_OPTIONS)[number];
export const AGENT_SCOPES = ["quote", "order:write", "order:read"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
export const CANCEL_REASONS = ["agent_requested", "operator_cancelled"] as const;
export const FAIL_REASONS = [
  "injection_rejected",
  "floor_reset",
  "floor_state_lost",
  "carrier_lost",
] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

export const agentOrderId = z.string().regex(/^ao-[0-9a-z]{10}$/);
export const quoteId = z.string().regex(/^aq-[0-9a-z]{10}$/);
const isoTime = z.string().datetime();
const simTime = z.number().finite().nonnegative();
export const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const agentReference = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9._:-]*$/, "Only letters, digits and . _ : - are allowed")
  .refine(
    (value) => !/\d{7,}/.test(value),
    "Looks like a phone or account number; do not send personal data",
  );
export const virtualAmount = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: z.literal(VIRTUAL_CURRENCY),
  })
  .strict();
const virtualNotice = { virtual: z.literal(true), disclaimer: z.string() };

export const FEASIBILITY_CODES = [
  "MODEL_UNKNOWN",
  "OPTION_NOT_OFFERED",
  "QUANTITY_ABOVE_LIMIT",
  "ZONE_UNKNOWN",
  "AGENT_ORDER_CAP",
  "FLOOR_ORDER_SLOTS_FULL",
  "ORDER_DESK_PAUSED",
  "ASSEMBLY_OUTAGE_ACTIVE",
  "SUPPLY_HOLD_ACTIVE",
  "DISPATCH_BLOCKAGE_ACTIVE",
  "CONGESTION_ACTIVE",
  "STATION_FAULTED",
  "STATION_PAUSED",
  "LOW_LINE_STOCK",
  "FORECAST_HORIZON_EXCEEDED",
] as const;
export type FeasibilityCode = (typeof FEASIBILITY_CODES)[number];
export const feasibilityIssue = z.object({
  code: z.enum(FEASIBILITY_CODES),
  severity: z.enum(["error", "warning", "info"]),
  featureRef: z.string().max(80).nullable(),
  measured: z.number().nullable(),
  limit: z.number().nullable(),
  unit: z.enum(["units", "orders", "kits", "s"]).nullable(),
  message: z.string().max(300),
  suggestion: z.string().max(300).nullable(),
});
export type FeasibilityIssue = z.infer<typeof feasibilityIssue>;

// Permissive strings on input so an unsupported option becomes a feasibility issue, not a schema error.
export const vehicleConfigInput = z
  .object({
    modelId: z.string().max(60),
    options: z
      .record(z.string().max(30), z.union([z.string().max(30), z.number().int()]))
      .default({}),
  })
  .strict();
export type VehicleConfigInput = z.infer<typeof vehicleConfigInput>;

// ---------- list_vehicle_configs ----------
export const listVehicleConfigsInput = z.object({}).strict();
export const listVehicleConfigsOutput = z.object({
  priceBookVersion: z.string(),
  models: z.array(
    z.object({
      modelId: z.string(),
      name: z.string(),
      recipeId: z.string(),
      recipeVersion: z.number().int(),
      description: z.string(),
      basePrice: virtualAmount,
      options: z.array(
        z.object({
          key: z.string(),
          values: z.array(
            z.object({
              value: z.union([z.string(), z.number()]),
              offered: z.boolean(),
              note: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
  ...virtualNotice,
});
export type ListVehicleConfigsOutput = z.infer<typeof listVehicleConfigsOutput>;

// ---------- get_capabilities ----------
export const getCapabilitiesInput = z.object({}).strict();
export const getCapabilitiesOutput = z.object({
  factory: z.object({
    name: z.literal("Brickworks dark factory (virtual)"),
    floorId: z.literal(FLOOR_ID),
    lines: z.array(
      z.object({
        id: z.enum(LINE_IDS),
        name: z.string(),
        nominalCycleSeconds: z.number(),
      }),
    ),
    recipe: z.object({
      id: z.string(),
      joiningOrder: z.array(z.enum(LINE_IDS)),
      inspection: z.array(z.string()),
    }),
    parkingBays: z.number().int(),
    destinationZones: z.array(
      z.object({
        id: z.enum(DESTINATION_ZONES),
        nominalTransitSeconds: z.number(),
      }),
    ),
    leadOptions: z.array(
      z.object({
        name: z.enum(LEAD_OPTIONS),
        productionPriority: z.number().int(),
      }),
    ),
    clockNote: z.string(),
  }),
  floorStatus: z.object({
    running: z.boolean(),
    simTime,
    speed: z.number(),
    intakePaused: z.boolean(),
    faults: z.object({
      supply: z.boolean(),
      congestion: z.boolean(),
      assembly: z.boolean(),
      dispatch: z.boolean(),
    }),
    stations: z.record(z.enum(LINE_IDS), z.string()),
    activeAgentOrders: z.number().int(),
    throughputPerHour: z.number(),
    source: z.literal("simulated"),
  }),
  limits: z.object({
    maxQuantityPerOrder: z.number().int(),
    maxActiveOrdersPerAgent: z.number().int(),
    maxActiveAgentOrdersOnFloor: z.number().int(),
    quoteTtlSeconds: z.number().int(),
    rateLimits: z.record(z.string(), z.string()),
  }),
  transports: z.object({
    mcp: z.string().url(),
    rest: z.string().url(),
    openapi: z.string().url(),
  }),
  ...virtualNotice,
});
export type GetCapabilitiesOutput = z.infer<typeof getCapabilitiesOutput>;

// ---------- quote_vehicle ----------
export const quoteVehicleInput = z
  .object({
    config: vehicleConfigInput,
    quantity: z.number().int().min(1).max(10),
    destinationZone: z.string().max(40),
    leadOptions: z
      .array(z.enum(LEAD_OPTIONS))
      .min(1)
      .max(2)
      .default(["standard", "expedite"]),
  })
  .strict();
export type QuoteVehicleInput = z.infer<typeof quoteVehicleInput>;
export const leadOptionQuote = z.object({
  name: z.enum(LEAD_OPTIONS),
  productionPriority: z.number().int().min(2).max(3),
  completeBySimTime: simTime.nullable(),
  shipBySimTime: simTime.nullable(),
  deliverBySimTime: simTime.nullable(),
  estimatedDeliveryAt: isoTime.nullable(),
  maxCarrierDelayFactor: z.number(),
  price: virtualAmount,
  source: z.literal("forecast"),
  confidence: z.enum(["firm-if-no-new-inputs", "at-risk", "unknown"]),
});
export type LeadOptionQuote = z.infer<typeof leadOptionQuote>;
export const QUOTE_STATUSES = ["quoted", "expired", "converted"] as const;
export const quoteVehicleOutput = z.object({
  quoteId,
  status: z.enum(QUOTE_STATUSES),
  expiresAt: isoTime,
  feasibility: z.object({
    manufacturable: z.boolean(),
    issues: z.array(feasibilityIssue),
  }),
  lines: z.array(
    z.object({
      code: z.string(),
      description: z.string(),
      quantity: z.number().int(),
      unitPrice: virtualAmount,
      total: virtualAmount,
    }),
  ),
  leadOptions: z.array(leadOptionQuote),
  basis: z.object({
    floorId: z.literal(FLOOR_ID),
    epoch: z.number().int(),
    revision: z.number().int(),
    simTime,
    basisHash: z.string(),
    priceBookVersion: z.string(),
    forecastHorizonSeconds: z.number(),
  }),
  ...virtualNotice,
});
export type QuoteVehicleOutput = z.infer<typeof quoteVehicleOutput>;

// ---------- order views ----------
export const STATION_PROGRESS_STATES = [
  "waiting",
  "building",
  "ready",
  "reserved",
] as const;
export const stationProgress = z.object({
  state: z.enum(STATION_PROGRESS_STATES),
  binding: z.enum(["projected", "bound"]),
  moduleId: z.string().nullable(),
  lot: z.string().nullable(),
  rework: z.number().int().min(0).max(1).nullable(),
  history: z
    .array(
      z.object({
        simTime,
        event: z.string(),
        defectClass: z.string().optional(),
      }),
    )
    .max(4),
});
export type StationProgress = z.infer<typeof stationProgress>;
export const DELAY_REASONS = [
  "virtual-weather",
  "virtual-road-closure",
  "virtual-hub-backlog",
  "virtual-operator-hold",
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number];
export const trackingLeg = z.object({
  from: z.string(),
  to: z.string(),
  plannedStart: simTime,
  plannedEnd: simTime,
  actualEnd: simTime.nullable(),
  delayed: z.boolean(),
  delayReason: z.enum(DELAY_REASONS).nullable(),
});
export type TrackingLeg = z.infer<typeof trackingLeg>;
export const CARRIER_NAME = "Brickworks Virtual Freight" as const;
export const trackingView = z.object({
  carrier: z.literal(CARRIER_NAME),
  trackingId: z.string(),
  zone: z.enum(DESTINATION_ZONES),
  legs: z.array(trackingLeg).max(5),
  etaSimTime: simTime.nullable(),
  etaAt: isoTime.nullable(),
  source: z.literal("simulated"),
});
export type TrackingView = z.infer<typeof trackingView>;
export const UNIT_STAGES = [
  "queued",
  "modules",
  "joining",
  "end_of_line_test",
  "rework",
  "staging",
  "parked",
  "dispatching",
  "carrier",
  "delivered",
] as const;
export type UnitStage = (typeof UNIT_STAGES)[number];
export const unitView = z.object({
  index: z.number().int().min(0).max(2),
  status: orderStatus,
  stage: z.enum(UNIT_STAGES).nullable(),
  vehicleId: z.string().nullable(),
  stations: z.record(z.enum(LINE_IDS), stationProgress),
  tracking: trackingView.nullable(),
});
export type UnitView = z.infer<typeof unitView>;
const estimateFields = leadOptionQuote.pick({
  completeBySimTime: true,
  shipBySimTime: true,
  deliverBySimTime: true,
  estimatedDeliveryAt: true,
});
export const orderView = z.object({
  orderId: agentOrderId,
  agentId: z.string(),
  quoteId,
  status: orderStatus,
  statusReason: z.string().nullable(),
  atRisk: z.object({
    value: z.boolean(),
    reasons: z.array(z.string()).max(10),
  }),
  config: z.object({
    modelId: z.string(),
    options: z.record(z.string(), z.union([z.string(), z.number()])),
  }),
  quantity: z.number().int().min(1).max(3),
  destinationZone: z.enum(DESTINATION_ZONES),
  leadOption: z.enum(LEAD_OPTIONS),
  price: virtualAmount,
  agentReference: z.string().nullable(),
  placedAt: isoTime,
  placedAtSimTime: simTime,
  factoryOrderId: z.string().nullable(),
  promised: estimateFields,
  latestEstimate: leadOptionQuote.pick({
    completeBySimTime: true,
    shipBySimTime: true,
    deliverBySimTime: true,
    estimatedDeliveryAt: true,
    confidence: true,
  }),
  units: z.array(unitView).max(3),
  lastUpdateSeq: z.number().int().nonnegative(),
  ...virtualNotice,
});
export type OrderView = z.infer<typeof orderView>;
export const orderSummary = orderView
  .pick({
    orderId: true,
    status: true,
    quantity: true,
    leadOption: true,
    destinationZone: true,
    placedAt: true,
    atRisk: true,
    lastUpdateSeq: true,
  })
  .extend({ etaAt: isoTime.nullable() });
export type OrderSummary = z.infer<typeof orderSummary>;

// ---------- place_order ----------
// No approval token: no money moves (contrast DF-SHOP-001 placeOrderInput).
export const placeOrderInput = z
  .object({
    quoteId,
    leadOption: z.enum(LEAD_OPTIONS),
    idempotencyKey,
    agentReference: agentReference.optional(),
  })
  .strict();
export type PlaceOrderInput = z.infer<typeof placeOrderInput>;
export const placeOrderOutput = z.object({
  order: orderView,
  replayed: z.boolean(),
});

// ---------- get_order / list_orders ----------
export const getOrderInput = z.object({ orderId: agentOrderId }).strict();
export const getOrderOutput = z.object({ order: orderView });
export const listOrdersInput = z
  .object({
    status: z.array(orderStatus).max(13).optional(),
    cursor: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListOrdersInput = z.infer<typeof listOrdersInput>;
export const listOrdersOutput = z.object({
  orders: z.array(orderSummary),
  nextCursor: z.string().nullable(),
});

// ---------- cancel_order ----------
export const cancelOrderInput = z
  .object({ orderId: agentOrderId, idempotencyKey })
  .strict();
export type CancelOrderInput = z.infer<typeof cancelOrderInput>;
export const cancelOrderOutput = z.object({
  order: orderView,
  cancelled: z.boolean(),
  replayed: z.boolean(),
});

// ---------- get_order_updates ----------
export const ORDER_UPDATE_TYPES = [
  "order.placed",
  "order.accepted",
  "order.scheduled",
  "order.at_risk",
  "order.risk_cleared",
  "unit.queue_head",
  "unit.queue_demoted",
  "unit.committed",
  "unit.joined",
  "unit.rework",
  "unit.passed",
  "order.completed",
  "unit.staging",
  "unit.parked",
  "unit.dispatch_started",
  "unit.shipped",
  "carrier.departed_hub",
  "carrier.arrived_hub",
  "carrier.delayed",
  "carrier.recovered",
  "carrier.out_for_delivery",
  "unit.delivered",
  "order.delivered",
  "order.cancelled",
  "order.failed",
  "estimate.revised",
] as const;
export type OrderUpdateType = (typeof ORDER_UPDATE_TYPES)[number];
export const orderUpdate = z.object({
  seq: z.number().int().positive(),
  orderId: agentOrderId,
  unitIndex: z.number().int().min(0).max(2).nullable(),
  type: z.enum(ORDER_UPDATE_TYPES),
  status: orderStatus,
  previousStatus: orderStatus.nullable(),
  at: isoTime,
  simTime,
  message: z.string().max(300),
  factoryEvent: z
    .object({ id: z.number().int(), type: z.string() })
    .nullable(),
  data: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  source: z.enum(["simulated", "forecast"]),
});
export type OrderUpdate = z.infer<typeof orderUpdate>;
export const getOrderUpdatesInput = z
  .object({
    orderId: agentOrderId.optional(),
    cursor: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    waitSeconds: z.number().int().min(0).max(20).default(0),
  })
  .strict();
export type GetOrderUpdatesInput = z.infer<typeof getOrderUpdatesInput>;
export const getOrderUpdatesOutput = z.object({
  updates: z.array(orderUpdate),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  oldestRetainedSeq: z.number().int(),
});
export type GetOrderUpdatesOutput = z.infer<typeof getOrderUpdatesOutput>;

// ---------- errors (MCP isError structuredContent and REST body) ----------
export const ORDER_DESK_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN_SCOPE",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "ORDER_DESK_DISABLED",
  "ORDER_DESK_PAUSED",
  "FLOOR_UNAVAILABLE",
  "QUOTE_NOT_FOUND",
  "QUOTE_EXPIRED",
  "QUOTE_INFEASIBLE",
  "IDEMPOTENCY_KEY_REUSED",
  "AGENT_ORDER_CAP",
  "FLOOR_FULL",
  "ORDER_NOT_FOUND",
  "CANCEL_NOT_ALLOWED",
  "CURSOR_EXPIRED",
] as const;
export type OrderDeskErrorCode = (typeof ORDER_DESK_ERROR_CODES)[number];
export const orderDeskError = z.object({
  error: z.object({
    code: z.enum(ORDER_DESK_ERROR_CODES),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().optional(),
    issues: z.array(feasibilityIssue).optional(),
  }),
});
export type OrderDeskErrorBody = z.infer<typeof orderDeskError>;
export const ORDER_DESK_ERROR_HTTP: Record<OrderDeskErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN_SCOPE: 403,
  ORDER_NOT_FOUND: 404,
  QUOTE_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  CANCEL_NOT_ALLOWED: 409,
  AGENT_ORDER_CAP: 409,
  FLOOR_FULL: 409,
  QUOTE_EXPIRED: 410,
  CURSOR_EXPIRED: 410,
  QUOTE_INFEASIBLE: 422,
  RATE_LIMITED: 429,
  ORDER_DESK_DISABLED: 503,
  FLOOR_UNAVAILABLE: 503,
  ORDER_DESK_PAUSED: 503,
};

// ---------- tool registry (shared by MCP, REST, discovery and tests) ----------
export const ORDER_TOOL_NAMES = [
  "list_vehicle_configs",
  "get_capabilities",
  "quote_vehicle",
  "place_order",
  "get_order",
  "list_orders",
  "cancel_order",
  "get_order_updates",
] as const;
export type OrderToolName = (typeof ORDER_TOOL_NAMES)[number];
export const ORDER_TOOL_SCOPES: Record<OrderToolName, AgentScope | null> = {
  list_vehicle_configs: null,
  get_capabilities: null,
  quote_vehicle: "quote",
  place_order: "order:write",
  get_order: "order:read",
  list_orders: "order:read",
  cancel_order: "order:write",
  get_order_updates: "order:read",
};
export const ORDER_TOOL_SUMMARIES: Record<OrderToolName, string> = {
  list_vehicle_configs:
    "Catalog of buildable vehicle configurations with offered and not-offered option values, virtual base prices and the price book id.",
  get_capabilities:
    "Factory lines, recipe, destination zones, limits and live simulated floor status.",
  quote_vehicle:
    "Feasibility check plus virtual price plus forecast lead options for a configuration; returns a quoteId.",
  place_order:
    "Convert a quote into a virtual order. Requires an idempotency key. No payment, no shipment.",
  get_order:
    "Full view of one of your orders with per-unit station progress and virtual carrier tracking.",
  list_orders: "Your orders, filterable by status, paginated.",
  cancel_order:
    "Cancel one of your orders before any unit is committed to final assembly. Requires an idempotency key.",
  get_order_updates:
    "Cursor-paged feed of ordered status updates with optional long poll; the protocol-independent way to follow orders.",
};

// ---------- public floor view (web Orders tab and live frames) ----------
export const deskOrderCard = z.object({
  orderId: agentOrderId,
  agentLabel: z.string().max(80),
  modelId: z.string().max(80),
  status: orderStatus,
  statusReason: z.string().nullable(),
  atRisk: z.object({ value: z.boolean(), reasons: z.array(z.string()).max(10) }),
  quantity: z.number().int().min(1).max(3),
  leadOption: z.enum(LEAD_OPTIONS),
  destinationZone: z.enum(DESTINATION_ZONES),
  price: virtualAmount,
  placedAtSimTime: simTime,
  factoryOrderId: z.string().nullable(),
  promised: estimateFields,
  latestEstimate: estimateFields,
  units: z.array(unitView).max(3),
  recentUpdates: z.array(orderUpdate).max(20),
});
export type DeskOrderCard = z.infer<typeof deskOrderCard>;
export const orderDeskViewSchema = z.object({
  floorId: z.literal(FLOOR_ID),
  simTime,
  intakePaused: z.boolean(),
  orders: z.array(deskOrderCard).max(50),
  metrics: z.object({
    active: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    meanQuotedShipSeconds: z.number().nullable(),
    meanActualShipSeconds: z.number().nullable(),
    onTimeShare: z.number().min(0).max(1).nullable(),
    source: z.literal("simulated"),
  }),
  virtual: z.literal(true),
  disclaimer: z.string(),
});
export type OrderDeskView = z.infer<typeof orderDeskViewSchema>;
