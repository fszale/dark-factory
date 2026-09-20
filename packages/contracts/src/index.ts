import { z } from "zod";
import { LINE_IDS, LINE_META } from "../../assets/src/design.ts";
export { LINE_IDS, LINE_META };
export type LineId = (typeof LINE_IDS)[number];
export const SCENARIOS = [
  "balanced",
  "shortage",
  "slow-exterior",
  "gripper",
  "congestion",
  "assembly-outage",
  "dispatch-blockage",
  "empty",
] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type Mode = "manual" | "advisory" | "autonomous";
export type StationStatus =
  | "idle"
  | "loading"
  | "processing"
  | "unloading"
  | "starved"
  | "blocked"
  | "faulted"
  | "maintenance"
  | "paused";
export const DEFECT_CLASSES = [
  "axle-alignment",
  "drive-fit",
  "floor-connection",
  "seat-fit",
  "panel-alignment",
  "door-operation",
  "incoming-kit-damage",
] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];
export interface ModuleReworkEvent {
  defectClass?: DefectClass;
  time: number;
  event:
    "inspection-passed" | "inspection-rejected" | "rework-started" | "scrapped";
  attempt: number;
}
export interface ModuleInstance {
  id: string;
  line: LineId;
  lot: string;
  created: number;
  accepted: boolean;
  rework: number;
  reworkHistory?: ModuleReworkEvent[];
}
export interface StationState {
  pause?: { previousStatus: Exclude<StationStatus, "paused">; since: number };
  pausedTime?: number;
  id: LineId;
  status: StationStatus;
  progress: number;
  phaseStart: number;
  phaseEnd: number;
  queue: ModuleInstance[];
  current: ModuleInstance | null;
  stock: number;
  capacity: number;
  profile: "gentle" | "normal" | "fast";
  completed: number;
  rejects: number;
  reworked: number;
  scrapped: number;
  cycles: number;
  busyTime: number;
  blockedTime: number;
  starvedTime: number;
  downTime: number;
  temperature: number;
  vibration: number;
  currentAmps: number;
  fault: string | null;
  maintenanceUntil: number;
  offset: number;
  wear: number;
}
export interface Truck {
  inspection?: "pending" | "accepted" | "rejected";
  id: string;
  phase: "approach" | "waiting" | "unloading" | "sorting" | "departing";
  start: number;
  end: number;
  amount: Record<LineId, number>;
  lot: string;
}
export interface Cart {
  id: string;
  line: LineId;
  phase: "loading" | "outbound" | "unloading" | "returning";
  start: number;
  end: number;
  amount: number;
  lot: string;
  charge: number;
}
export interface ProductionOrder {
  id: string;
  quantity: number;
  completed: number;
  priority: number;
  status: "queued" | "in-progress";
  createdAt: number;
  source: "showcase" | "manual";
}
export interface Vehicle {
  orderId?: string;
  id: string;
  phase:
    "joining" | "testing" | "outbound" | "parking" | "parked" | "dispatching";
  start: number;
  end: number;
  slot: number;
  modules: ModuleInstance[];
  created: number;
  completedAt: number | null;
  quality: "pending" | "passed" | "rework";
}
export interface FactoryEvent {
  id: number;
  time: number;
  type: string;
  entity: string;
  message: string;
  data?: Record<string, unknown>;
}
export interface DecisionKpiSnapshot {
  time: number;
  completed: number;
  dispatched: number;
  throughput: number;
  yield: number;
  energy: number;
  dockWait: number;
  assemblyWait: number;
  parkingWait: number;
  wip: number;
  stock: number;
}
export type DecisionKpiDeltas = Omit<DecisionKpiSnapshot, "time">;
export interface DecisionCommandResult {
  commandId: string;
  status: "applied" | "rejected" | "not-applied" | "experimented";
  message: string;
  revision: number;
}
export interface ProviderExperimentAction {
  id: string;
  type: "experiment";
  station?: LineId;
  value: string;
}
export type DecisionAction = FactoryCommand | ProviderExperimentAction;
export interface DecisionExperimentEvidence {
  status: "completed" | "discarded" | "failed";
  requestedProfile: { line: LineId; profile: "gentle" | "normal" | "fast" };
  completedAt?: number;
  provenance: "paired-deterministic-simulation";
  runs?: number;
  seeds?: number[];
  baseline?: Record<string, number>;
  candidate?: Record<string, number>;
  differences?: Record<string, number>;
  note: string;
}
export interface DecisionAftermath {
  status: "complete" | "interrupted";
  windowSeconds: number;
  baseline: DecisionKpiSnapshot;
  measurement: DecisionKpiSnapshot;
  deltas: DecisionKpiDeltas;
  interpretation: "observational-not-causal";
}
export interface MetricSample {
  time: number;
  completed: number;
  throughput: number;
  wip: number;
  yield: number;
  stock: number;
  parked: number;
  energy: number;
  cost: number;
  blocked: number;
}
export interface DecisionRecord {
  id: string;
  provider: "astra" | "jev";
  time: number;
  summary: string;
  status: "applied" | "advisory" | "rejected" | "error" | "pending";
  latency: number;
  commands: FactoryCommand[];
  tokens: number;
  revision: number;
  source?: DecisionKpiSnapshot;
  applicationTime?: number;
  commandResults?: DecisionCommandResult[];
  aftermath?: DecisionAftermath;
  experiment?: DecisionExperimentEvidence;
}
export interface FactoryConfig {
  seed: number;
  scenario: Scenario;
  orderSize: number;
  continuous: boolean;
  releaseRate: number;
  reorderPoint: number;
  deliverySize: number;
  deliveryLead: number;
  dispatchDwell: number;
  parkingCapacity: number;
  bufferCapacity: number;
  profiles: Record<LineId, "gentle" | "normal" | "fast">;
  materialPriority?: Record<LineId, number>;
  materialLoadingCapacity?: number;
}
export interface FactoryMetrics {
  received: number;
  initial: number;
  consumed: number;
  scrap: number;
  completed: number;
  dispatched: number;
  deliveries: number;
  rejectedDeliveries: number;
  energy: number;
  materialCost: number;
  maintenanceCost: number;
  throughput: number;
  yield: number;
  leadTime: number;
  costPerVehicle: number;
  dockWait: number;
  cartTravel: number;
  cartWait: number;
  assemblyWait: number;
  parkingWait: number;
  inspectionCount: number;
  inspectionRejects: number;
  simulationMs: number;
  [key: string]: number;
}
export interface FactorySnapshot {
  version: 1;
  id: string;
  time: number;
  revision: number;
  epoch: number;
  running: boolean;
  speed: number;
  mode: Mode;
  config: FactoryConfig;
  stations: Record<LineId, StationState>;
  warehouse: Record<LineId, number>;
  trucks: Truck[];
  carts: Cart[];
  vehicles: Vehicle[];
  orders: ProductionOrder[];
  events: FactoryEvent[];
  samples: MetricSample[];
  decisions: DecisionRecord[];
  metrics: FactoryMetrics;
  faults: {
    supply: boolean;
    congestion: boolean;
    assembly: boolean;
    dispatch: boolean;
  };
  providers: { astra: boolean; jev: boolean };
  nextDelivery: number;
}
export interface LiveSnapshotMessage {
  type: "snapshot";
  sessionId: string;
  sequence: number;
  sentAt: number;
  snapshot: FactorySnapshot;
}
export const commandSchema = z
  .object({
    id: z.string().min(1).max(120),
    type: z.enum([
      "start",
      "pause",
      "step",
      "reset",
      "speed",
      "mode",
      "fault",
      "repair",
      "profile",
      "priority",
      "order-create",
      "order-priority",
      "buffer",
      "config",
      "layout",
    ]),
    station: z.enum(LINE_IDS).optional(),
    value: z
      .union([z.number().finite(), z.string().max(120), z.boolean()])
      .optional(),
    scenario: z.enum(SCENARIOS).optional(),
    revision: z.number().int().nonnegative().optional(),
    epoch: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FactoryCommand = z.infer<typeof commandSchema>;
export interface CommandResult {
  ok: boolean;
  message: string;
  revision: number;
}
export interface RunExport {
  format: "brickworks-run";
  version: 1;
  snapshot: FactorySnapshot;
  internal: Record<string, unknown>;
}
export interface ExperimentResult {
  name: string;
  runs: number;
  baseline: Record<string, number>;
  candidate: Record<string, number>;
  differences: Record<string, number>;
  seeds: number[];
  note: string;
  perSeed?: Array<{
    seed: number;
    baseline: Record<string, number>;
    candidate: Record<string, number>;
    differences: Record<string, number>;
    appliedActions?: number;
    rejectedActions?: number;
  }>;
  standardDeviation?: {
    baseline: Record<string, number>;
    candidate: Record<string, number>;
    differences: Record<string, number>;
  };
  policySource?: "recorded-ai" | "configured-profiles";
  actionCount?: number;
  sourceDecisionIds?: string[];
  candidateProfiles?: Record<LineId, "gentle" | "normal" | "fast">;
  baselineName?: string;
  candidateName?: string;
  baselineConfig?: Partial<FactoryConfig>;
  candidateConfig?: Partial<FactoryConfig>;
}
export type AdaptiveExperimentJobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";
export interface AdaptiveExperimentProgress {
  phase:
    | "queued"
    | "pair-started"
    | "decision-requested"
    | "decision-completed"
    | "pair-completed";
  seed?: number;
  completedPairs: number;
  requestedDecisions: number;
  completedDecisions: number;
  simulationTime: number;
}
export interface AdaptiveExperimentBounds {
  pairedSeeds: 10;
  decisionCheckpoints: number;
  maximumProviderCalls: number;
  providerCallsPerMinute: number;
  timeoutMinutes: number;
}
export interface AdaptiveExperimentTrace {
  decisionId: string;
  seed: number;
  checkpoint: number;
  simulationTime: number;
  revision: number;
  epoch: number;
  provider: "astra" | "jev";
  source: "live-provider" | "test-fixture";
  summary: string;
  tokens: number;
  latencyMs: number;
  model?: string;
  observation: Record<string, unknown>;
  actions: Array<{
    command: FactoryCommand;
    appliedCommand?: FactoryCommand;
    ok: boolean;
    message: string;
    revision: number;
  }>;
}
export interface AdaptiveExperimentResult {
  status: "completed";
  completedPairs: 10;
  providers: Array<"astra" | "jev">;
  models: string[];
  sourceDecisionIds: string[];
  name: string;
  runs: 10;
  seeds: number[];
  simulatedDuration: 1800;
  decisionTimes: number[];
  policySource: "live-adaptive-ai" | "adaptive-test-fixture";
  baseline: Record<string, number>;
  candidate: Record<string, number>;
  differences: Record<string, number>;
  perSeed: Array<{
    seed: number;
    baseline: Record<string, number>;
    candidate: Record<string, number>;
    differences: Record<string, number>;
    appliedActions: number;
    rejectedActions: number;
  }>;
  standardDeviation: {
    baseline: Record<string, number>;
    candidate: Record<string, number>;
    differences: Record<string, number>;
  };
  baselineConfig: Partial<FactoryConfig>;
  candidateConfig: Partial<FactoryConfig>;
  trace: AdaptiveExperimentTrace[];
  requestedDecisions: number;
  completedDecisions: number;
  tokens: number;
  note: string;
}
export interface AdaptiveExperimentJob {
  jobId: string;
  status: AdaptiveExperimentJobStatus;
  provider: "astra" | "jev";
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  progress: AdaptiveExperimentProgress;
  bounds: AdaptiveExperimentBounds;
  result?: AdaptiveExperimentResult;
  error?: string;
}
export interface ProviderStatus {
  astra: { configured: boolean; status: string };
  jev: { configured: boolean; status: string };
  accessRequired: boolean;
}
export interface StationAdapter {
  id: string;
  observe(): StationState;
  execute(command: FactoryCommand): CommandResult;
  capabilities: string[];
}
export const DEFAULT_CONFIG: FactoryConfig = {
  seed: 42,
  scenario: "balanced",
  orderSize: 10,
  continuous: true,
  releaseRate: 1,
  reorderPoint: 12,
  deliverySize: 15,
  deliveryLead: 20,
  dispatchDwell: 80,
  parkingCapacity: 12,
  bufferCapacity: 3,
  materialPriority: { front: 3, rear: 3, battery: 3, interior: 3, exterior: 3 },
  materialLoadingCapacity: 2,
  profiles: {
    front: "normal",
    rear: "normal",
    battery: "normal",
    interior: "normal",
    exterior: "normal",
  },
};
