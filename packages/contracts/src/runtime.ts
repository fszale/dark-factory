import { z } from "zod";
import { LINE_IDS, SCENARIOS, DEFECT_CLASSES, commandSchema } from "./index.ts";

const n = z.number().finite().nonnegative();
const count = n.int();
const id = z.string().min(1).max(200);
const line = z.enum(LINE_IDS);
const status = z.enum([
  "idle",
  "loading",
  "processing",
  "unloading",
  "starved",
  "blocked",
  "faulted",
  "maintenance",
  "paused",
]);
const profile = z.enum(["gentle", "normal", "fast"]);
const byLine = (item: z.ZodTypeAny) =>
  z
    .record(line, item)
    .refine(
      (value) => LINE_IDS.every((key) => key in value),
      "All five production lines are required",
    );
export const moduleSchema = z.object({
  id,
  line,
  lot: id,
  created: n,
  accepted: z.boolean(),
  rework: count.max(1),
  reworkHistory: z
    .array(
      z.object({
        time: n,
        event: z.enum([
          "inspection-passed",
          "inspection-rejected",
          "rework-started",
          "scrapped",
        ]),
        attempt: count.max(1),
        defectClass: z.enum(DEFECT_CLASSES).optional(),
      }),
    )
    .max(4)
    .optional(),
});
export const stationSchema = z.object({
  pause: z
    .object({ previousStatus: status.exclude(["paused"]), since: n })
    .optional(),
  pausedTime: n.optional(),
  id: line,
  status,
  progress: n.max(1),
  phaseStart: n,
  phaseEnd: n,
  queue: z.array(moduleSchema).max(8),
  current: moduleSchema.nullable(),
  stock: count.max(8),
  capacity: count.min(1).max(8),
  profile,
  completed: count,
  rejects: count,
  reworked: count,
  scrapped: count,
  cycles: count,
  busyTime: n,
  blockedTime: n,
  starvedTime: n,
  downTime: n,
  temperature: n,
  vibration: z.number().finite(),
  currentAmps: n,
  fault: z.string().max(200).nullable(),
  maintenanceUntil: n,
  offset: z.number().int().min(-1).max(1),
  wear: n.max(1),
});
export const truckSchema = z.object({
  inspection: z.enum(["pending", "accepted", "rejected"]).optional(),
  id,
  phase: z.enum(["approach", "waiting", "unloading", "sorting", "departing"]),
  start: n,
  end: n,
  amount: byLine(count.max(60)),
  lot: id,
});
export const cartSchema = z.object({
  id,
  line,
  phase: z.enum(["loading", "outbound", "unloading", "returning"]),
  start: n,
  end: n,
  amount: count.max(5),
  lot: id,
  charge: n.max(100),
});
export const productionOrderSchema = z
  .object({
    id,
    quantity: count.min(1).max(1000),
    completed: count,
    priority: count.min(1).max(5),
    status: z.enum(["queued", "in-progress"]),
    createdAt: n,
    source: z.enum(["showcase", "manual"]),
  })
  .refine(
    (order) => order.completed < order.quantity,
    "Completed orders must retire to the event archive",
  );
export const vehicleSchema = z.object({
  orderId: id.optional(),
  id,
  phase: z.enum([
    "joining",
    "testing",
    "outbound",
    "parking",
    "parked",
    "dispatching",
  ]),
  start: n,
  end: n,
  slot: count.max(11),
  modules: z
    .array(moduleSchema)
    .length(5)
    .refine(
      (modules) =>
        new Set(modules.map((m) => m.line)).size === 5 &&
        modules.every((m) => m.accepted),
      "Vehicle requires five distinct accepted modules",
    ),
  created: n,
  completedAt: n.nullable(),
  quality: z.enum(["pending", "passed", "rework"]),
});
export const eventSchema = z.object({
  id: count,
  time: n,
  type: id,
  entity: id,
  message: z.string().max(4000),
  data: z.record(z.unknown()).optional(),
});
export const sampleSchema = z.object({
  time: n,
  completed: count,
  throughput: n,
  wip: count,
  yield: n.max(100),
  stock: count,
  parked: count,
  energy: n,
  cost: n,
  blocked: count,
});
const decisionKpiSchema = z.object({
  time: n,
  completed: count,
  dispatched: count,
  throughput: n,
  yield: n.max(100),
  energy: n,
  dockWait: n,
  assemblyWait: n,
  parkingWait: n,
  wip: count,
  stock: count,
});
const decisionDeltasSchema = z.object({
  completed: z.number().finite(),
  dispatched: z.number().finite(),
  throughput: z.number().finite(),
  yield: z.number().finite(),
  energy: z.number().finite(),
  dockWait: z.number().finite(),
  assemblyWait: z.number().finite(),
  parkingWait: z.number().finite(),
  wip: z.number().finite(),
  stock: z.number().finite(),
});
export const decisionSchema = z.object({
  id,
  provider: z.enum(["astra", "jev"]),
  time: n,
  summary: z.string().max(12000),
  status: z.enum(["applied", "advisory", "rejected", "error", "pending"]),
  latency: n,
  commands: z.array(commandSchema).max(50),
  tokens: n,
  revision: count,
  source: decisionKpiSchema.optional(),
  applicationTime: n.optional(),
  commandResults: z
    .array(
      z.object({
        commandId: commandSchema.shape.id,
        status: z.enum(["applied", "rejected", "not-applied", "experimented"]),
        message: z.string().max(4000),
        revision: count,
      }),
    )
    .max(5)
    .optional(),
  aftermath: z
    .object({
      status: z.enum(["complete", "interrupted"]),
      windowSeconds: n.max(120),
      baseline: decisionKpiSchema,
      measurement: decisionKpiSchema,
      deltas: decisionDeltasSchema,
      interpretation: z.literal("observational-not-causal"),
    })
    .optional(),
  experiment: z
    .object({
      status: z.enum(["completed", "discarded", "failed"]),
      requestedProfile: z.object({ line, profile }),
      completedAt: n.optional(),
      provenance: z.literal("paired-deterministic-simulation"),
      runs: count.optional(),
      seeds: z.array(count).max(10).optional(),
      baseline: z.record(z.number().finite()).optional(),
      candidate: z.record(z.number().finite()).optional(),
      differences: z.record(z.number().finite()).optional(),
      note: z.string().max(4000),
    })
    .optional(),
});
export const configSchema = z.object({
  seed: count,
  scenario: z.enum(SCENARIOS),
  orderSize: count.min(1).max(1000),
  continuous: z.boolean(),
  releaseRate: n.min(0.1).max(3),
  reorderPoint: count.min(1).max(40),
  deliverySize: count.min(1).max(60),
  deliveryLead: n.min(1),
  dispatchDwell: n.min(5),
  parkingCapacity: count.min(1).max(12),
  bufferCapacity: count.min(1).max(8),
  profiles: byLine(profile),
  materialPriority: byLine(count.min(1).max(5)).optional(),
  materialLoadingCapacity: count.min(1).max(3).optional(),
});
const requiredMetrics = [
  "received",
  "initial",
  "consumed",
  "scrap",
  "completed",
  "dispatched",
  "deliveries",
  "rejectedDeliveries",
  "energy",
  "materialCost",
  "maintenanceCost",
  "throughput",
  "yield",
  "leadTime",
  "costPerVehicle",
  "dockWait",
  "cartTravel",
  "cartWait",
  "assemblyWait",
  "parkingWait",
  "inspectionCount",
  "inspectionRejects",
  "simulationMs",
];
export const metricsSchema = z
  .record(z.number().finite())
  .refine(
    (metrics) =>
      requiredMetrics.every((key) => key in metrics && metrics[key] >= 0),
    "Required factory counters must be present",
  );
const lotsSchema = byLine(
  z.array(z.object({ id, amount: count.min(1).max(60) })).max(60),
);
export const checkpointSchema = z.object({
  format: z.literal("brickworks-run"),
  version: z.literal(1),
  snapshot: z.object({
    version: z.literal(1),
    id,
    time: n,
    revision: count,
    epoch: count,
    running: z.boolean(),
    speed: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]),
    mode: z.enum(["manual", "advisory", "autonomous"]),
    config: configSchema,
    stations: byLine(stationSchema),
    warehouse: byLine(count.max(60)),
    trucks: z.array(truckSchema).max(1),
    carts: z
      .array(cartSchema)
      .max(5)
      .refine(
        (carts) => new Set(carts.map((c) => c.line)).size === carts.length,
        "Cart destination already reserved",
      ),
    orders: z.array(productionOrderSchema).max(20).optional(),
    vehicles: z
      .array(vehicleSchema)
      .max(12)
      .refine(
        (vehicles) =>
          new Set(vehicles.map((v) => v.slot)).size === vehicles.length,
        "Parking slot already reserved",
      ),
    events: z.array(eventSchema).max(2000),
    samples: z.array(sampleSchema).max(720),
    decisions: z.array(decisionSchema).max(200),
    metrics: metricsSchema,
    faults: z.object({
      supply: z.boolean(),
      congestion: z.boolean(),
      assembly: z.boolean(),
      dispatch: z.boolean(),
    }),
    providers: z.object({ astra: z.boolean(), jev: z.boolean() }),
    nextDelivery: n,
  }),
  internal: z.object({
    warehouseLots: lotsSchema,
    stationLots: lotsSchema,
    streams: z.record(count),
    counters: z.record(count),
    resumes: z.record(line, z.object({ status, remaining: n })),
    nextSample: n,
    nextRelease: n,
    leadTotal: n,
    audit: z.array(z.record(z.unknown())).max(200),
    commandPayloads: z
      .array(z.tuple([commandSchema.shape.id, commandSchema]))
      .max(500)
      .refine(
        (entries) => new Set(entries.map(([id]) => id)).size === entries.length,
        "Duplicate checkpoint command payload IDs",
      )
      .optional()
      .default([]),
    commands: z
      .array(
        z.tuple([
          commandSchema.shape.id,
          z
            .object({
              ok: z.boolean(),
              message: z.string().max(4000),
              revision: count,
            })
            .strict(),
        ]),
      )
      .max(500)
      .refine(
        (entries) => new Set(entries.map(([id]) => id)).size === entries.length,
        "Duplicate checkpoint command IDs",
      ),
  }),
});

/** Runtime contracts shared by transport consumers and checkpoint import. */
export const snapshotSchema = checkpointSchema.shape.snapshot;
export const providerStatusSchema = z.object({
  astra: z.object({ configured: z.boolean(), status: z.string().max(400) }),
  jev: z.object({ configured: z.boolean(), status: z.string().max(400) }),
  accessRequired: z.boolean(),
});
export const snapshotMessageSchema = z.object({
  type: z.literal("snapshot"),
  sessionId: id,
  sequence: count,
  sentAt: n.optional(),
  snapshot: snapshotSchema,
});
const finiteMetrics = z.record(z.number().finite());
export const experimentResultSchema = z.object({
  name: z.string(),
  runs: count.min(1).max(10),
  seeds: z.array(count).length(10),
  baseline: finiteMetrics,
  candidate: finiteMetrics,
  differences: finiteMetrics,
  note: z.string(),
  perSeed: z
    .array(
      z.object({
        seed: count,
        baseline: finiteMetrics,
        candidate: finiteMetrics,
        differences: finiteMetrics,
        appliedActions: count.optional(),
        rejectedActions: count.optional(),
      }),
    )
    .length(10)
    .optional(),
  standardDeviation: z
    .object({
      baseline: finiteMetrics,
      candidate: finiteMetrics,
      differences: finiteMetrics,
    })
    .optional(),
  baselineName: z.string().max(60).optional(),
  candidateName: z.string().max(60).optional(),
  baselineConfig: configSchema.partial().optional(),
  candidateConfig: configSchema.partial().optional(),
  policySource: z.enum(["configured-profiles", "recorded-ai"]).optional(),
  actionCount: count.optional(),
  sourceDecisionIds: z.array(id).max(200).optional(),
  candidateProfiles: z.record(line, profile).optional(),
});
export const commandResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  revision: count,
});

export const adaptiveExperimentRequestSchema = z
  .object({
    provider: z.enum(["astra", "jev"]),
    accessCode: z.string().max(256).optional(),
    config: configSchema.omit({ seed: true }).partial().strict().optional(),
    decisionTimes: z
      .array(z.number().finite().min(0).max(1799.999999))
      .min(1)
      .max(3)
      .refine(
        (values) =>
          values.every(
            (value, index) => index === 0 || value > values[index - 1],
          ),
        "Decision checkpoints must be strictly increasing",
      )
      .optional(),
  })
  .strict();
const adaptiveProgressSchema = z.object({
  phase: z.enum([
    "queued",
    "pair-started",
    "decision-requested",
    "decision-completed",
    "pair-completed",
  ]),
  seed: count.optional(),
  completedPairs: count.max(10),
  requestedDecisions: count.max(30),
  completedDecisions: count.max(30),
  simulationTime: n.max(1800),
});
const adaptiveBoundsSchema = z.object({
  pairedSeeds: z.literal(10),
  decisionCheckpoints: count.min(1).max(3),
  maximumProviderCalls: count.min(10).max(30),
  providerCallsPerMinute: count.min(1).max(12),
  timeoutMinutes: count.min(1).max(20),
});
const adaptiveTraceSchema = z.object({
  seed: count,
  checkpoint: count.max(2),
  simulationTime: n.max(1800),
  revision: count,
  epoch: count,
  provider: z.enum(["astra", "jev"]),
  source: z.enum(["live-provider", "test-fixture"]),
  summary: z.string().max(4000),
  tokens: count.max(100_000),
  latencyMs: n,
  model: z.string().max(120).optional(),
  decisionId: id,
  observation: z.record(z.unknown()),
  actions: z
    .array(
      z.object({
        command: commandSchema,
        appliedCommand: commandSchema.optional(),
        ok: z.boolean(),
        message: z.string().max(4000),
        revision: count,
      }),
    )
    .max(6),
});
export const adaptiveExperimentResultSchema = z.object({
  status: z.literal("completed"),
  completedPairs: z.literal(10),
  providers: z
    .array(z.enum(["astra", "jev"]))
    .min(1)
    .max(2),
  models: z.array(z.string().max(120)).max(2),
  sourceDecisionIds: z.array(id).min(10).max(30),
  name: z.string().max(200),
  runs: z.literal(10),
  seeds: z.array(count).length(10),
  simulatedDuration: z.literal(1800),
  decisionTimes: z.array(n.max(1800)).min(1).max(3),
  policySource: z.enum(["live-adaptive-ai", "adaptive-test-fixture"]),
  baseline: finiteMetrics,
  candidate: finiteMetrics,
  differences: finiteMetrics,
  perSeed: z
    .array(
      z.object({
        seed: count,
        baseline: finiteMetrics,
        candidate: finiteMetrics,
        differences: finiteMetrics,
        appliedActions: count,
        rejectedActions: count,
      }),
    )
    .length(10),
  standardDeviation: z.object({
    baseline: finiteMetrics,
    candidate: finiteMetrics,
    differences: finiteMetrics,
  }),
  baselineConfig: configSchema.partial(),
  candidateConfig: configSchema.partial(),
  trace: z.array(adaptiveTraceSchema).max(30),
  requestedDecisions: count.max(30),
  completedDecisions: count.max(30),
  tokens: count,
  note: z.string().max(4000),
});
export const adaptiveExperimentJobSchema = z.object({
  jobId: id,
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  provider: z.enum(["astra", "jev"]),
  createdAt: n,
  updatedAt: n,
  startedAt: n.optional(),
  completedAt: n.optional(),
  progress: adaptiveProgressSchema,
  bounds: adaptiveBoundsSchema,
  result: adaptiveExperimentResultSchema.optional(),
  error: z.string().max(400).optional(),
});
