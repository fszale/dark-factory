import { existsSync, mkdtempSync, rmSync } from "node:fs";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import {
  type AdaptiveExperimentJob,
  type AdaptiveExperimentProgress,
  type AdaptiveExperimentResult,
  commandSchema,
  LINE_IDS,
  SCENARIOS,
  type CommandResult,
  type DecisionAction,
  type DecisionAftermath,
  type DecisionCommandResult,
  type DecisionExperimentEvidence,
  type DecisionKpiDeltas,
  type DecisionKpiSnapshot,
  type DecisionRecord,
  type FactoryCommand,
  type FactoryConfig,
  type FactorySnapshot,
  type ExperimentResult,
  type LineId,
  type ProviderExperimentAction,
  type RunExport,
} from "../../../packages/contracts/src/index.ts";
import {
  adaptiveExperimentRequestSchema,
  adaptiveExperimentResultSchema,
  configSchema,
} from "../../../packages/contracts/src/runtime.ts";
import { FactorySimulation } from "../../../packages/simulation/src/index.ts";
import type {
  ExperimentInput,
  RecordedAction,
} from "../../../packages/simulation/src/experiments.ts";
import {
  adaptivePairedExperiment,
  type AdaptiveComparisonInput,
  type AdaptiveExperimentResult as SimulationAdaptiveExperimentResult,
  type AdaptiveOptions,
} from "../../../packages/simulation/src/adaptive-experiments.ts";
import {
  createProviderSet,
  decisionRecord,
  ProviderUnavailableError,
  validateProviderDecision,
  type ProviderAdapter,
  type ProviderDecision,
  type ProviderId,
  type ProviderSet,
} from "../../../packages/providers/src/index.ts";
import { ArchiveCapacityError, ArchiveStore } from "./archive.ts";

const createSessionSchema = z
  .object({
    scenario: z.enum(SCENARIOS).optional(),
    seed: z.number().int().optional(),
    accessCode: z.string().max(256).optional(),
  })
  .strict();
const chatSchema = z
  .object({
    message: z.string().min(1).max(4000),
    accessCode: z.string().max(256).optional(),
  })
  .strict();
const jevSchema = z
  .object({ accessCode: z.string().max(256).optional() })
  .strict();
const importSchema = z.object({ run: z.unknown() }).strict();
const profileSchema = z.record(
  z.enum(LINE_IDS),
  z.enum(["gentle", "normal", "fast"]),
);
const experimentConfigSchema = configSchema
  .omit({ seed: true })
  .partial()
  .strict();
const experimentSchema = z
  .object({
    mode: z.enum(["profiles", "recorded-ai"]).optional(),
    profiles: profileSchema.optional(),
    baselineConfig: experimentConfigSchema.optional(),
    candidateConfig: experimentConfigSchema.optional(),
    baselineName: z.string().min(1).max(60).optional(),
    candidateName: z.string().min(1).max(60).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.mode === "recorded-ai" &&
      (value.profiles || value.baselineConfig || value.candidateConfig)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recorded action replay uses one shared baseline context",
      });
    }
  });
const replaySchema = z
  .object({ time: z.number().finite().nonnegative() })
  .strict();
const retainedCommandResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().max(4000),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const retainedCommandResultsSchema = z
  .array(z.tuple([z.string().min(1).max(120), retainedCommandResultSchema]))
  .max(500);
const retainedCommandPayloadsSchema = z
  .array(z.tuple([z.string().min(1).max(120), commandSchema]))
  .max(500);

interface SessionRate {
  astra: number[];
  jev: number[];
}

interface PendingAftermath {
  decisionId: string;
  epoch: number;
  targetTime: number;
  baseline: DecisionKpiSnapshot;
}

interface LiveAppliedDecision {
  time: number;
  provider: ProviderId;
  decisionId: string;
  commands: FactoryCommand[];
}

interface Session {
  id: string;
  token: string;
  simulation: FactorySimulation;
  lastAccess: number;
  clients: number;
  controlVersion: number;
  aiAuthorized: boolean;
  commands: Map<string, { fingerprint: string; result: CommandResult }>;
  rate: SessionRate;
  inflight: Record<ProviderId, boolean>;
  lastEventId: number;
  unsubscribeArchive: () => void;
  experimentInflight: boolean;
  archiveEpoch: number;
  archiveTime: number;
  pendingAftermath: Map<string, PendingAftermath>;
  liveAppliedDecisions: LiveAppliedDecision[];
  liveSequence: number;
  liveMessage?: { sequence: number; payload: string };
  adaptiveJobId?: string;
}

interface InternalAdaptiveJob {
  sessionId: string;
  controller: AbortController;
  cancelReason?: "operator" | "expired" | "closed" | "requested" | "timeout";
  value: AdaptiveExperimentJob;
}

export interface BuildAppOptions {
  providers?: Partial<Record<ProviderId, ProviderAdapter>>;
  publicMode?: boolean;
  accessCode?: string;
  sessionIdleMs?: number;
  maxSessions?: number;
  tickMs?: number;
  globalTokenLimit?: number;
  importBodyLimitBytes?: number;
  aftermathWindowSeconds?: number;
  experimentRunner?: (input: ExperimentInput) => Promise<ExperimentResult>;
  adaptiveRunner?: (
    input: AdaptiveComparisonInput,
    options: AdaptiveOptions,
  ) => Promise<SimulationAdaptiveExperimentResult>;
  archiveDir?: string;
  archiveRetentionMs?: number;
  archiveSessionBytes?: number;
  archiveGlobalBytes?: number;
  logger?: boolean;
}

function secretMatches(
  actual: string | undefined,
  expected: string | undefined,
) {
  if (!actual || !expected) return false;
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function errorReply(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positive(value: number | string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const KPI_DELTA_KEYS = [
  "completed",
  "dispatched",
  "throughput",
  "yield",
  "energy",
  "dockWait",
  "assemblyWait",
  "parkingWait",
  "wip",
  "stock",
] as const satisfies readonly (keyof DecisionKpiDeltas)[];

function decisionKpis(snapshot: FactorySnapshot): DecisionKpiSnapshot {
  const stock =
    Object.values(snapshot.warehouse).reduce(
      (total, value) => total + value,
      0,
    ) +
    Object.values(snapshot.stations).reduce(
      (total, station) => total + station.stock,
      0,
    );
  const wip =
    Object.values(snapshot.stations).reduce(
      (total, station) =>
        total + station.queue.length + (station.current ? 1 : 0),
      0,
    ) +
    snapshot.vehicles.filter(
      (vehicle) => vehicle.phase === "joining" || vehicle.phase === "testing",
    ).length *
      5;
  return {
    time: snapshot.time,
    completed: snapshot.metrics.completed,
    dispatched: snapshot.metrics.dispatched,
    throughput: snapshot.metrics.throughput,
    yield: snapshot.metrics.yield,
    energy: snapshot.metrics.energy,
    dockWait: snapshot.metrics.dockWait,
    assemblyWait: snapshot.metrics.assemblyWait,
    parkingWait: snapshot.metrics.parkingWait,
    wip,
    stock,
  };
}

function measuredAftermath(
  baseline: DecisionKpiSnapshot,
  measurement: DecisionKpiSnapshot,
  status: DecisionAftermath["status"],
): DecisionAftermath {
  const deltas = {} as DecisionKpiDeltas;
  for (const key of KPI_DELTA_KEYS)
    deltas[key] = measurement[key] - baseline[key];
  return {
    status,
    windowSeconds: Math.max(0, Math.min(120, measurement.time - baseline.time)),
    baseline,
    measurement,
    deltas,
    interpretation: "observational-not-causal",
  };
}

function retainedCommands(run: RunExport) {
  const results = retainedCommandResultsSchema.safeParse(run.internal.commands);
  const payloads = retainedCommandPayloadsSchema.safeParse(
    run.internal.commandPayloads,
  );
  const restored = new Map<
    string,
    { fingerprint: string; result: CommandResult }
  >();
  if (!results.success || !payloads.success) return restored;
  const byId = new Map(results.data);
  for (const [id, command] of payloads.data) {
    const result = byId.get(id);
    if (command.id === id && result)
      restored.set(id, { fingerprint: JSON.stringify(command), result });
  }
  return restored;
}

class ExperimentCapacityError extends Error {}

function isExperimentAction(
  action: DecisionAction,
): action is ProviderExperimentAction {
  return action.type === "experiment";
}

function requestedExperiment(action: ProviderExperimentAction) {
  const [line, profile] = action.value.split(":") as [
    LineId,
    "gentle" | "normal" | "fast",
  ];
  return { line, profile };
}

function runExperiment(workerData: ExperimentInput) {
  return new Promise<ExperimentResult>((resolvePromise, reject) => {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const worker = new Worker(
      new URL(`./experiment-worker.${extension}`, import.meta.url),
      { workerData },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("experiment worker timed out"));
    }, 30_000);
    timeout.unref();
    worker.once("message", (value: ExperimentResult) => {
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
        reject(new Error(`experiment worker exited ${code}`));
      }
    });
  });
}

interface ReplayWorkerResult {
  run: RunExport;
  sourceEpoch: number;
  targetTime: number;
  availableTime: number;
}
function runReplay(path: string, time: number) {
  return new Promise<ReplayWorkerResult>((resolvePromise, reject) => {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const worker = new Worker(
      new URL(`./replay-worker.${extension}`, import.meta.url),
      { workerData: { path, time } },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("replay worker timed out"));
    }, 30_000);
    timeout.unref();
    worker.once("message", (value: ReplayWorkerResult) => {
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
        reject(new Error(`replay worker exited ${code}`));
      }
    });
  });
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const providers: ProviderSet = createProviderSet(options.providers);
  const publicMode = options.publicMode ?? process.env.PUBLIC_MODE === "true";
  const accessCode =
    options.accessCode ??
    process.env.BRICKWORKS_ACCESS_CODE ??
    process.env.ACCESS_CODE;
  const sessionIdleMs = positive(
    options.sessionIdleMs ?? process.env.SESSION_IDLE_MS,
    30 * 60_000,
  );
  const maxSessions = options.maxSessions ?? 10;
  const tickMs = positive(options.tickMs, 125);
  const globalTokenLimit = positive(
    options.globalTokenLimit ?? process.env.AI_GLOBAL_TOKEN_LIMIT,
    100_000,
  );
  const importBodyLimitBytes = positive(
    options.importBodyLimitBytes,
    16 * 1024 * 1024,
  );
  const aftermathWindowSeconds = Math.min(
    120,
    positive(options.aftermathWindowSeconds, 120),
  );
  const experimentRunner = options.experimentRunner ?? runExperiment;
  const adaptiveRunner = options.adaptiveRunner ?? adaptivePairedExperiment;
  const temporaryArchive =
    (process.env.NODE_ENV === "test" || process.env.VITEST === "true") &&
    !options.archiveDir;
  const archiveDir =
    options.archiveDir ??
    (temporaryArchive
      ? mkdtempSync(join(tmpdir(), "brickworks-archives-"))
      : resolve(process.cwd(), process.env.ARCHIVE_DIR || ".data/archives"));
  const archives = new ArchiveStore({
    directory: archiveDir,
    retentionMs: positive(
      options.archiveRetentionMs ?? process.env.ARCHIVE_RETENTION_MS,
      24 * 60 * 60_000,
    ),
    sessionBytes: positive(
      options.archiveSessionBytes ?? process.env.ARCHIVE_SESSION_BYTES,
      64 * 1024 * 1024,
    ),
    globalBytes: positive(
      options.archiveGlobalBytes ?? process.env.ARCHIVE_GLOBAL_BYTES,
      256 * 1024 * 1024,
    ),
  });
  const sessions = new Map<string, Session>();
  let globalTokens = 0;
  let globalReservedTokens = 0;
  let tokenWindowStarted = Date.now();
  const globalInflight: Record<ProviderId, boolean> = {
    astra: false,
    jev: false,
  };
  let globalExperiments = 0;
  let globalAdaptiveJobs = 0;
  let globalReplays = 0;
  const replayInflight = new Set<string>();
  const adaptiveJobs = new Map<string, InternalAdaptiveJob>();

  await app.register(websocket);

  const webRoot = resolve(process.cwd(), "dist/web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
  }

  function codeAllowsAI(code?: string) {
    return !publicMode || secretMatches(code, accessCode);
  }

  function configuredStatus() {
    return providers.status(publicMode);
  }

  function cancelAdaptiveJob(
    session: Session,
    reason: InternalAdaptiveJob["cancelReason"],
  ) {
    if (!session.adaptiveJobId) return false;
    const job = adaptiveJobs.get(session.adaptiveJobId);
    if (!job || !["queued", "running"].includes(job.value.status)) {
      session.adaptiveJobId = undefined;
      return false;
    }
    job.cancelReason = reason;
    const now = Date.now();
    job.value = {
      ...job.value,
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
      error:
        reason === "operator"
          ? "Factory control changed; adaptive comparison cancelled."
          : "Adaptive comparison cancelled.",
    };
    job.controller.abort();
    session.adaptiveJobId = undefined;
    return true;
  }

  function pruneAdaptiveJobs(sessionId: string) {
    const terminal = [...adaptiveJobs.values()]
      .filter(
        (job) =>
          job.sessionId === sessionId &&
          !["queued", "running"].includes(job.value.status),
      )
      .sort((left, right) => right.value.updatedAt - left.value.updatedAt);
    for (const job of terminal.slice(5)) adaptiveJobs.delete(job.value.jobId);
  }

  function expireSessions() {
    const cutoff = Date.now() - sessionIdleMs;
    for (const [id, session] of sessions) {
      if (session.clients === 0 && session.lastAccess < cutoff) {
        cancelAdaptiveJob(session, "expired");
        writeWatermark(session, true);
        session.unsubscribeArchive();
        sessions.delete(id);
        for (const [jobId, job] of adaptiveJobs) {
          if (
            job.sessionId === id &&
            !["queued", "running"].includes(job.value.status)
          )
            adaptiveJobs.delete(jobId);
        }
      }
    }
    archives.cleanup(Date.now(), new Set(sessions.keys()));
  }

  function createSession(
    simulation: FactorySimulation,
    aiAuthorized: boolean,
  ): Session | null {
    expireSessions();
    if (sessions.size >= maxSessions) return null;
    const id = simulation.snapshot().id;
    const token = randomBytes(32).toString("base64url");
    simulation.setProviders({
      astra: providers.astra.configured,
      jev: providers.jev.configured,
    });
    const checkpoint = simulation.exportRun();
    archives.begin(id, token, checkpoint);
    const unsubscribeArchive = simulation.subscribeEvents((entry) => {
      try {
        archives.append(id, entry);
      } catch (error) {
        archives.markTruncated(id, "archive write failed");
        app.log.error({ sessionId: id }, "Factory archive append failed");
        throw error;
      }
    });
    const session: Session = {
      id,
      token,
      simulation,
      lastAccess: Date.now(),
      clients: 0,
      controlVersion: 0,
      aiAuthorized,
      commands: retainedCommands(checkpoint),
      rate: { astra: [], jev: [] },
      inflight: { astra: false, jev: false },
      lastEventId: simulation.snapshot().events.at(-1)?.id ?? 0,
      unsubscribeArchive,
      experimentInflight: false,
      archiveEpoch: simulation.snapshot().epoch,
      archiveTime: simulation.snapshot().time,
      pendingAftermath: new Map(),
      liveAppliedDecisions: [],
      liveSequence: 0,
    };
    sessions.set(id, session);
    return session;
  }

  function writeWatermark(session: Session, force = false) {
    const snapshot = session.simulation.status();
    if (
      !force &&
      snapshot.epoch === session.archiveEpoch &&
      snapshot.time - session.archiveTime < 30
    )
      return;
    if (
      snapshot.epoch === session.archiveEpoch &&
      snapshot.time === session.archiveTime
    )
      return;
    try {
      archives.append(session.id, {
        kind: "watermark",
        epoch: snapshot.epoch,
        time: snapshot.time,
      });
      session.archiveEpoch = snapshot.epoch;
      session.archiveTime = snapshot.time;
    } catch {
      archives.markTruncated(session.id, "archive write failed");
      app.log.error(
        { sessionId: session.id },
        "Factory archive watermark failed",
      );
    }
  }

  function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const { id } = (request.params ?? {}) as { id?: string };
    const session = id ? sessions.get(id) : undefined;
    if (!session) {
      errorReply(reply, 404, "Session not found.");
      return null;
    }
    const token = firstHeader(request.headers["x-session-token"]);
    if (!secretMatches(token, session.token)) {
      errorReply(reply, 401, "Invalid session token.");
      return null;
    }
    session.lastAccess = Date.now();
    return session;
  }

  function resetGlobalTokenWindow(now: number) {
    if (now - tokenWindowStarted >= 60 * 60_000) {
      globalTokens = 0;
      tokenWindowStarted = now;
    }
  }

  function withinRate(session: Session, provider: ProviderId, now: number) {
    resetGlobalTokenWindow(now);
    if (
      globalTokens + globalReservedTokens >= globalTokenLimit ||
      globalInflight[provider] ||
      session.inflight[provider]
    )
      return false;
    const maximum = provider === "astra" ? 2 : 12;
    session.rate[provider] = session.rate[provider].filter(
      (time) => now - time < 60_000,
    );
    if (session.rate[provider].length >= maximum) return false;
    session.rate[provider].push(now);
    return true;
  }

  function waitForAdaptiveSlot(delay: number, signal: AbortSignal) {
    return new Promise<void>((resolvePromise, reject) => {
      if (signal.aborted)
        return reject(new Error("Adaptive comparison cancelled."));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolvePromise();
      }, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("Adaptive comparison cancelled."));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  async function acquireAdaptiveProviderSlot(
    session: Session,
    providerId: ProviderId,
    signal: AbortSignal,
    deadline: number,
  ) {
    const maximum = providerId === "astra" ? 2 : 12;
    while (true) {
      if (signal.aborted) throw new Error("Adaptive comparison cancelled.");
      const now = Date.now();
      if (now >= deadline) throw new Error("Adaptive comparison timed out.");
      resetGlobalTokenWindow(now);
      if (globalTokens + globalReservedTokens >= globalTokenLimit)
        throw new Error("AI token capacity reached.");
      session.rate[providerId] = session.rate[providerId].filter(
        (time) => now - time < 60_000,
      );
      if (
        !globalInflight[providerId] &&
        !session.inflight[providerId] &&
        session.rate[providerId].length < maximum
      ) {
        session.rate[providerId].push(now);
        globalInflight[providerId] = true;
        session.inflight[providerId] = true;
        globalReservedTokens += 10_000;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          globalInflight[providerId] = false;
          session.inflight[providerId] = false;
          globalReservedTokens = Math.max(0, globalReservedTokens - 10_000);
        };
      }
      const rateDelay =
        session.rate[providerId].length >= maximum
          ? Math.max(10, session.rate[providerId][0] + 60_000 - now)
          : 50;
      await waitForAdaptiveSlot(Math.min(rateDelay, 5_000), signal);
    }
  }

  async function adaptiveProviderDecision(
    session: Session,
    providerId: ProviderId,
    request: Parameters<AdaptiveOptions["decide"]>[0],
    deadline: number,
  ) {
    const provider = providers[providerId];
    if (!provider.configured || !provider.decideObservation)
      throw new ProviderUnavailableError(providerId);
    const release = await acquireAdaptiveProviderSlot(
      session,
      providerId,
      request.signal,
      deadline,
    );
    try {
      const decision = await provider.decideObservation(
        request.observation,
        `Adaptive paired comparison, seed ${request.seed}, checkpoint ${request.checkpoint + 1}. Choose only bounded profile, priority, order-priority, buffer, repair, or config actions justified by this observation.`,
        request.signal,
      );
      if (
        !validateProviderDecision(decision) ||
        decision.commands.some(isExperimentAction)
      )
        throw new Error("Invalid adaptive provider decision.");
      globalTokens += decision.tokens;
      return {
        decisionId: `adaptive-${providerId}-${randomUUID()}`,
        ...(provider.model ? { model: provider.model } : {}),
        provider: providerId,
        source:
          provider.source === "live-provider"
            ? ("live-provider" as const)
            : ("test-fixture" as const),
        summary: decision.summary,
        commands: decision.commands as FactoryCommand[],
        tokens: decision.tokens,
      };
    } finally {
      release();
    }
  }

  async function executeSessionExperiment(
    session: Session,
    input: ExperimentInput,
  ) {
    if (session.experimentInflight || globalExperiments >= 2)
      throw new ExperimentCapacityError("Experiment capacity reached.");
    session.experimentInflight = true;
    globalExperiments++;
    try {
      return await experimentRunner(input);
    } finally {
      session.experimentInflight = false;
      globalExperiments = Math.max(0, globalExperiments - 1);
    }
  }

  function runAdaptiveJob(
    session: Session,
    internal: InternalAdaptiveJob,
    input: AdaptiveComparisonInput,
    providerId: ProviderId,
    timeoutMs: number,
  ) {
    const startedControlVersion = session.controlVersion;
    globalAdaptiveJobs++;
    void (async () => {
      const startedAt = Date.now();
      internal.value = {
        ...internal.value,
        status: "running",
        startedAt,
        updatedAt: startedAt,
      };
      const timeout = setTimeout(() => {
        if (["queued", "running"].includes(internal.value.status)) {
          internal.cancelReason = "timeout";
          internal.controller.abort();
        }
      }, timeoutMs);
      timeout.unref();
      try {
        const result = await adaptiveRunner(input, {
          signal: internal.controller.signal,
          decisionTimeoutMs: 90_000,
          decide: (request) =>
            adaptiveProviderDecision(
              session,
              providerId,
              request,
              startedAt + timeoutMs,
            ),
          onProgress: (progress) => {
            if (!["queued", "running"].includes(internal.value.status)) return;
            internal.value = {
              ...internal.value,
              updatedAt: Date.now(),
              progress: { ...progress },
            };
          },
        });
        if (
          internal.controller.signal.aborted ||
          session.controlVersion !== startedControlVersion ||
          sessions.get(session.id) !== session
        ) {
          throw new Error("Adaptive comparison cancelled.");
        }
        const parsed = adaptiveExperimentResultSchema.safeParse(result);
        if (!parsed.success) throw new Error("Invalid adaptive result.");
        const expectedSource =
          providers[providerId].source === "live-provider"
            ? "live-adaptive-ai"
            : "adaptive-test-fixture";
        if (parsed.data.policySource !== expectedSource)
          throw new Error("Invalid adaptive provenance.");
        const completedAt = Date.now();
        internal.value = {
          ...internal.value,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
          progress: {
            phase: "pair-completed",
            completedPairs: 10,
            requestedDecisions: parsed.data.requestedDecisions,
            completedDecisions: parsed.data.completedDecisions,
            simulationTime: 1800,
          },
          result: parsed.data as AdaptiveExperimentResult,
        };
      } catch {
        const completedAt = Date.now();
        const cancelled =
          internal.cancelReason && internal.cancelReason !== "timeout";
        internal.value = {
          ...internal.value,
          status: cancelled ? "cancelled" : "failed",
          updatedAt: completedAt,
          completedAt,
          error: cancelled
            ? internal.cancelReason === "operator"
              ? "Factory control changed; adaptive comparison cancelled."
              : "Adaptive comparison cancelled."
            : internal.cancelReason === "timeout"
              ? "Adaptive comparison timed out."
              : "Adaptive comparison failed.",
        };
      } finally {
        clearTimeout(timeout);
        globalAdaptiveJobs = Math.max(0, globalAdaptiveJobs - 1);
        if (session.adaptiveJobId === internal.value.jobId)
          session.adaptiveJobId = undefined;
        if (!sessions.has(session.id))
          adaptiveJobs.delete(internal.value.jobId);
        else pruneAdaptiveJobs(session.id);
      }
    })();
  }

  async function askProvider(
    session: Session,
    providerId: ProviderId,
    message?: string,
    autonomous = false,
  ): Promise<DecisionRecord> {
    const provider = providers[providerId];
    if (!provider.configured) throw new ProviderUnavailableError(providerId);
    const now = Date.now();
    if (!withinRate(session, providerId, now))
      throw new Error("AI request limit reached.");
    const before = session.simulation.snapshot();
    const source = decisionKpis(before);
    const controlVersion = session.controlVersion;
    session.inflight[providerId] = true;
    globalInflight[providerId] = true;
    // Reserve a conservative bounded request while its exact SDK usage is unknown.
    globalReservedTokens += 10_000;
    let decision: ProviderDecision;
    try {
      decision = await provider.decide(before, message);
      if (!validateProviderDecision(decision))
        throw new Error("Invalid provider decision");
      globalTokens += decision.tokens;
    } finally {
      session.inflight[providerId] = false;
      globalInflight[providerId] = false;
      globalReservedTokens = Math.max(0, globalReservedTokens - 10_000);
    }
    const experimentAction = decision.commands.find(isExperimentAction);
    let experiment: DecisionExperimentEvidence | undefined;
    if (experimentAction) {
      const requested = requestedExperiment(experimentAction);
      const common = {
        requestedProfile: requested,
        provenance: "paired-deterministic-simulation" as const,
      };
      try {
        const result = await executeSessionExperiment(session, {
          mode: "profiles",
          profiles: { [requested.line]: requested.profile },
        });
        const after = session.simulation.snapshot();
        const fresh =
          after.epoch === before.epoch &&
          session.controlVersion === controlVersion;
        experiment = fresh
          ? {
              ...common,
              status: "completed",
              completedAt: after.time,
              runs: result.runs,
              seeds: result.seeds,
              baseline: result.baseline,
              candidate: result.candidate,
              differences: result.differences,
              note: `Paired deterministic simulation completed for ${requested.line}:${requested.profile}. ${result.note}`,
            }
          : {
              ...common,
              status: "discarded",
              note: "Experiment result was discarded because factory control changed while the worker was running.",
            };
      } catch (error) {
        experiment = {
          ...common,
          status: "failed",
          note:
            error instanceof ExperimentCapacityError
              ? "Experiment was not run because bounded worker capacity was in use."
              : "Experiment worker failed; no result was retained.",
        };
      }
    }
    const current = session.simulation.snapshot();
    const application = decisionKpis(current);
    const mayApply =
      autonomous &&
      current.mode === "autonomous" &&
      current.running &&
      current.epoch === before.epoch &&
      session.controlVersion === controlVersion;
    const factoryCommands = decision.commands.filter(
      (command): command is FactoryCommand => !isExperimentAction(command),
    );
    let status: DecisionRecord["status"] =
      mayApply && factoryCommands.length ? "applied" : "advisory";
    const commands: DecisionAction[] = [];
    const commandResults: DecisionCommandResult[] = [];
    for (const command of decision.commands) {
      if (isExperimentAction(command)) {
        commands.push(command);
        commandResults.push({
          commandId: command.id,
          status:
            experiment?.status === "completed"
              ? "experimented"
              : experiment?.status === "failed"
                ? "rejected"
                : "not-applied",
          message: experiment?.note ?? "Experiment was not run.",
          revision: current.revision,
        });
        if (experiment?.status === "failed") status = "rejected";
        continue;
      }
      if (mayApply) {
        const state = session.simulation.snapshot();
        const guarded = {
          ...command,
          revision: state.revision,
          epoch: state.epoch,
        };
        commands.push(guarded);
        const result = session.simulation.command(guarded);
        commandResults.push({
          commandId: guarded.id,
          status: result.ok ? "applied" : "rejected",
          message: result.message,
          revision: result.revision,
        });
        if (!result.ok) status = "rejected";
      } else {
        commands.push(command);
        const heldMessage = !autonomous
          ? "Advisory decision; command was not applied."
          : current.epoch !== before.epoch ||
              session.controlVersion !== controlVersion
            ? "Factory control changed while the provider was responding; command was not applied."
            : "Factory is not currently running in autonomous mode; command was not applied.";
        commandResults.push({
          commandId: command.id,
          status: "not-applied",
          message: heldMessage,
          revision: current.revision,
        });
      }
    }
    const record: DecisionRecord = {
      ...decisionRecord(
        providerId,
        {
          ...decision,
          commands: commands.filter(
            (command): command is FactoryCommand =>
              !isExperimentAction(command),
          ),
        },
        current,
        Date.now() - now,
        status,
      ),
      source,
      applicationTime: application.time,
      commandResults,
      ...(experiment ? { experiment } : {}),
    };
    session.simulation.addDecision(record);
    session.pendingAftermath.set(record.id, {
      decisionId: record.id,
      epoch: session.simulation.snapshot().epoch,
      targetTime: application.time + aftermathWindowSeconds,
      baseline: application,
    });
    if (
      status === "applied" &&
      factoryCommands.length > 0 &&
      commandResults
        .filter((result) => result.status !== "experimented")
        .every((result) => result.status === "applied")
    ) {
      const appliedCommands = commands.filter(
        (command): command is FactoryCommand => !isExperimentAction(command),
      );
      session.liveAppliedDecisions.push({
        time: application.time,
        provider: providerId,
        decisionId: record.id,
        commands: structuredClone(appliedCommands),
      });
      session.liveAppliedDecisions = session.liveAppliedDecisions.slice(-200);
    }
    return record;
  }

  function finishAftermath(
    session: Session,
    snapshot: FactorySnapshot,
    status: DecisionAftermath["status"],
    epoch = snapshot.epoch,
  ) {
    const measurement = decisionKpis(snapshot);
    for (const [id, pending] of session.pendingAftermath) {
      if (pending.epoch !== epoch) continue;
      if (status === "complete" && snapshot.time + 1e-8 < pending.targetTime)
        continue;
      const aftermath = measuredAftermath(
        pending.baseline,
        measurement,
        status,
      );
      // The engine emits the durable audit event and keeps the snapshot record in sync.
      if (
        session.simulation.updateDecisionAftermath(id, aftermath) ||
        status === "interrupted" ||
        !snapshot.decisions.some((decision) => decision.id === id)
      ) {
        session.pendingAftermath.delete(id);
      }
    }
  }

  function advanceWithAftermath(session: Session, realSeconds: number) {
    if (!session.pendingAftermath.size) {
      session.simulation.advance(realSeconds);
      return;
    }
    let remaining = realSeconds;
    while (remaining > 1e-8) {
      const before = session.simulation.status();
      if (!before.running) break;
      const next = Math.min(
        ...[...session.pendingAftermath.values()]
          .filter(
            (pending) =>
              pending.epoch === before.epoch &&
              pending.targetTime > before.time + 1e-8,
          )
          .map((pending) => pending.targetTime),
      );
      const toTarget = Number.isFinite(next)
        ? (next - before.time) / before.speed
        : Infinity;
      const slice = Math.min(remaining, toTarget);
      session.simulation.advance(slice);
      remaining -= slice;
      finishAftermath(session, session.simulation.snapshot(), "complete");
      if (slice <= 1e-8) break;
    }
  }

  function providerFailure(
    session: Session,
    provider: ProviderId,
    started: number,
  ) {
    const snapshot = session.simulation.snapshot();
    const record: DecisionRecord = {
      id: `decision-${provider}-${randomUUID()}`,
      provider,
      time: snapshot.time,
      summary: `${provider === "astra" ? "Astra" : "Jev"} request failed; factory settings were held.`,
      status: "error",
      latency: Date.now() - started,
      commands: [],
      tokens: 0,
      revision: snapshot.revision,
    };
    session.simulation.addDecision(record);
    return record;
  }

  function scheduleAutonomous(session: Session, provider: ProviderId) {
    if (!providers[provider].configured) return;
    const started = Date.now();
    void askProvider(
      session,
      provider,
      "A new factory event occurred. Review whether a bounded operational change is justified.",
      true,
    ).catch((error) => {
      if (
        !(error instanceof ProviderUnavailableError) &&
        error instanceof Error &&
        error.message === "AI request limit reached."
      )
        return;
      providerFailure(session, provider, started);
    });
  }

  let tickProcessingMs = 0;
  const tick = setInterval(() => {
    const tickStarted = performance.now();
    expireSessions();
    for (const session of sessions.values()) {
      advanceWithAftermath(session, tickMs / 1000);
      writeWatermark(session);
      const after = session.simulation.status();
      const eventId = after.lastEventId;
      const operationalEvent = after.mode === "autonomous" && after.running &&
        session.simulation.hasOperationalEventAfter(session.lastEventId);
      if (after.mode === "autonomous" && after.running && operationalEvent) {
        scheduleAutonomous(session, "astra");
        scheduleAutonomous(session, "jev");
      }
      session.lastEventId = eventId;
      session.liveSequence++;
    }
    tickProcessingMs = performance.now() - tickStarted;
  }, tickMs);
  tick.unref();
  app.addHook("onClose", async () => {
    clearInterval(tick);
    for (const session of sessions.values()) {
      cancelAdaptiveJob(session, "closed");
      writeWatermark(session, true);
      session.unsubscribeArchive();
    }
    if (temporaryArchive) rmSync(archiveDir, { recursive: true, force: true });
  });

  app.get("/api/health", async () => ({
    ok: true,
    providers: configuredStatus(),
    application: {
      uptimeSeconds: process.uptime(),
      heapUsedBytes: process.memoryUsage().heapUsed,
      rssBytes: process.memoryUsage().rss,
      activeSessions: sessions.size,
      viewers: [...sessions.values()].reduce((n, s) => n + s.clients, 0),
      tickProcessingMs,
    },
  }));

  app.post("/api/sessions", async (request, reply) => {
    const body = createSessionSchema.safeParse(request.body ?? {});
    if (!body.success)
      return errorReply(reply, 400, "Invalid session request.");
    const simulation = new FactorySimulation(
      {
        ...(body.data.scenario !== undefined
          ? { scenario: body.data.scenario }
          : {}),
        ...(body.data.seed !== undefined ? { seed: body.data.seed } : {}),
      },
      randomUUID(),
    );
    let session: Session | null;
    try {
      session = createSession(simulation, codeAllowsAI(body.data.accessCode));
    } catch (error) {
      if (error instanceof ArchiveCapacityError)
        return errorReply(reply, 507, "Archive capacity reached.");
      throw error;
    }
    if (!session) return errorReply(reply, 503, "Session capacity reached.");
    return {
      id: session.id,
      token: session.token,
      snapshot: simulation.snapshot(),
      providers: configuredStatus(),
    };
  });

  app.get("/api/sessions/:id", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    return {
      snapshot: session.simulation.snapshot(),
      providers: configuredStatus(),
    };
  });

  app.post("/api/sessions/:id/command", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success)
      return errorReply(reply, 400, "Invalid factory command.");
    // Any valid operator request supersedes an outstanding autonomous proposal,
    // including a retry or a rejected id collision.
    cancelAdaptiveJob(session, "operator");
    session.controlVersion++;
    session.liveMessage = undefined;
    const fingerprint = JSON.stringify(parsed.data);
    const previous = session.commands.get(parsed.data.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return errorReply(
          reply,
          409,
          "Command id was already used for a different command.",
        );
      return previous.result;
    }
    const beforeCommand = session.simulation.snapshot();
    const result = session.simulation.command(parsed.data);
    const afterCommand = session.simulation.snapshot();
    if (result.ok && parsed.data.type === "reset")
      session.liveAppliedDecisions = [];
    if (result.ok && afterCommand.epoch !== beforeCommand.epoch)
      finishAftermath(
        session,
        beforeCommand,
        "interrupted",
        beforeCommand.epoch,
      );
    session.commands.set(parsed.data.id, { fingerprint, result });
    if (session.commands.size > 500)
      session.commands.delete(session.commands.keys().next().value!);
    return result;
  });

  app.post("/api/sessions/:id/chat", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    const body = chatSchema.safeParse(request.body);
    if (!body.success) return errorReply(reply, 400, "Invalid chat request.");
    if (!session.aiAuthorized && !codeAllowsAI(body.data.accessCode))
      return errorReply(reply, 403, "AI access code required.");
    if (codeAllowsAI(body.data.accessCode)) session.aiAuthorized = true;
    const started = Date.now();
    try {
      const decision = await askProvider(
        session,
        "astra",
        body.data.message,
        session.simulation.snapshot().mode === "autonomous",
      );
      return { decision, snapshot: session.simulation.snapshot() };
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        return errorReply(reply, 503, "Astra is not configured.");
      if (
        error instanceof Error &&
        error.message === "AI request limit reached."
      )
        return errorReply(reply, 429, error.message);
      const decision = providerFailure(session, "astra", started);
      return reply.code(502).send({
        error: "Astra request failed.",
        decision,
        snapshot: session.simulation.snapshot(),
      });
    }
  });

  app.post("/api/sessions/:id/jev", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    const body = jevSchema.safeParse(request.body ?? {});
    if (!body.success) return errorReply(reply, 400, "Invalid Jev request.");
    if (!session.aiAuthorized && !codeAllowsAI(body.data.accessCode))
      return errorReply(reply, 403, "AI access code required.");
    if (codeAllowsAI(body.data.accessCode)) session.aiAuthorized = true;
    const started = Date.now();
    try {
      const decision = await askProvider(
        session,
        "jev",
        undefined,
        session.simulation.snapshot().mode === "autonomous",
      );
      return { decision, snapshot: session.simulation.snapshot() };
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        return errorReply(reply, 503, "Jev is not configured.");
      if (
        error instanceof Error &&
        error.message === "AI request limit reached."
      )
        return errorReply(reply, 429, error.message);
      const decision = providerFailure(session, "jev", started);
      return reply.code(502).send({
        error: "Jev request failed.",
        decision,
        snapshot: session.simulation.snapshot(),
      });
    }
  });

  app.get("/api/sessions/:id/export", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    return session.simulation.exportRun();
  });

  app.get("/api/sessions/:id/history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = firstHeader(request.headers["x-session-token"]);
    if (!token) return errorReply(reply, 401, "Invalid session token.");
    const live = sessions.get(id);
    if (live && secretMatches(token, live.token)) writeWatermark(live, true);
    const download = archives.download(id, token);
    if (!download) return errorReply(reply, 404, "Session history not found.");
    reply.header("content-type", "application/x-ndjson");
    reply.header(
      "content-disposition",
      `attachment; filename="brickworks-${id}.ndjson"`,
    );
    reply.header("x-archive-records", String(download.records));
    reply.header("x-archive-truncated", String(download.truncated));
    return reply.send(download.stream);
  });

  app.post("/api/sessions/:id/replay", async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = firstHeader(request.headers["x-session-token"]);
    if (!token) return errorReply(reply, 401, "Invalid session token.");
    const body = replaySchema.safeParse(request.body);
    if (!body.success) return errorReply(reply, 400, "Invalid replay request.");
    expireSessions();
    if (sessions.size >= maxSessions)
      return errorReply(reply, 503, "Session capacity reached.");
    if (replayInflight.has(id) || globalReplays >= 2)
      return errorReply(reply, 429, "Replay capacity reached.");
    const live = sessions.get(id);
    if (live && secretMatches(token, live.token)) writeWatermark(live, true);
    const source = archives.source(id, token);
    if (!source) return errorReply(reply, 404, "Session history not found.");
    if (source.truncated) {
      source.release();
      return errorReply(
        reply,
        409,
        "Truncated session history cannot be replayed.",
      );
    }
    replayInflight.add(id);
    globalReplays++;
    try {
      const replayed = await runReplay(source.path, body.data.time);
      const imported = {
        ...replayed.run,
        snapshot: {
          ...replayed.run.snapshot,
          id: randomUUID(),
          running: false,
        },
      } as RunExport;
      const session = createSession(
        FactorySimulation.fromExport(imported),
        false,
      );
      if (!session) return errorReply(reply, 503, "Session capacity reached.");
      return {
        id: session.id,
        token: session.token,
        snapshot: session.simulation.snapshot(),
        providers: configuredStatus(),
      };
    } catch (error) {
      if (error instanceof ArchiveCapacityError)
        return errorReply(reply, 507, "Archive capacity reached.");
      if (error instanceof Error && error.message === "replay worker timed out")
        return errorReply(reply, 504, "Replay timed out.");
      return errorReply(reply, 422, "Archive cannot be replayed at that time.");
    } finally {
      source.release();
      replayInflight.delete(id);
      globalReplays = Math.max(0, globalReplays - 1);
    }
  });

  app.post(
    "/api/import",
    { bodyLimit: importBodyLimitBytes },
    async (request, reply) => {
      const body = importSchema.safeParse(request.body);
      if (!body.success)
        return errorReply(reply, 400, "Invalid import request.");
      try {
        const simulation = FactorySimulation.fromExport(body.data.run);
        const old = simulation.exportRun();
        const imported = {
          ...old,
          snapshot: { ...old.snapshot, id: randomUUID() },
        } as RunExport;
        const session = createSession(
          FactorySimulation.fromExport(imported),
          false,
        );
        if (!session)
          return errorReply(reply, 503, "Session capacity reached.");
        return {
          id: session.id,
          token: session.token,
          snapshot: session.simulation.snapshot(),
          providers: configuredStatus(),
        };
      } catch (error) {
        if (error instanceof ArchiveCapacityError)
          return errorReply(reply, 507, "Archive capacity reached.");
        return errorReply(reply, 400, "Run import is invalid.");
      }
    },
  );

  app.post("/api/sessions/:id/experiments", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    const body = experimentSchema.safeParse(request.body ?? {});
    if (!body.success)
      return errorReply(reply, 400, "Invalid experiment request.");
    const input: ExperimentInput = {
      mode: body.data.mode ?? "profiles",
      profiles: body.data.profiles,
      baselineConfig: body.data.baselineConfig as
        Partial<FactoryConfig> | undefined,
      candidateConfig: body.data.candidateConfig as
        Partial<FactoryConfig> | undefined,
      baselineName: body.data.baselineName,
      candidateName: body.data.candidateName,
    };
    if (input.mode === "recorded-ai") {
      const operational = new Set<FactoryCommand["type"]>([
        "profile",
        "buffer",
        "repair",
        "config",
        "priority",
      ]);
      const eligible = session.liveAppliedDecisions
        .map((decision) => ({
          ...decision,
          commands: decision.commands.filter((command) =>
            operational.has(command.type),
          ),
        }))
        .filter((decision) => decision.commands.length > 0);
      if (!eligible.length)
        return errorReply(
          reply,
          400,
          "No live applied AI actions are available for comparison.",
        );
      const origin = eligible[0].time;
      input.schedule = eligible
        .map((decision): RecordedAction => ({
          time: Math.max(0, decision.time - origin),
          provider: decision.provider,
          decisionId: decision.decisionId,
          commands: decision.commands,
        }))
        .filter((decision) => decision.time <= 1800);
    }
    try {
      return await executeSessionExperiment(session, input);
    } catch (error) {
      if (error instanceof ExperimentCapacityError)
        return errorReply(reply, 429, error.message);
      return errorReply(reply, 500, "Experiment failed.");
    }
  });

  app.post("/api/sessions/:id/adaptive-experiments", async (request, reply) => {
    const session = authenticate(request, reply);
    if (!session) return;
    const body = adaptiveExperimentRequestSchema.safeParse(request.body ?? {});
    if (!body.success)
      return errorReply(reply, 400, "Invalid adaptive comparison request.");
    if (!session.aiAuthorized && !codeAllowsAI(body.data.accessCode))
      return errorReply(reply, 403, "AI access code required.");
    if (codeAllowsAI(body.data.accessCode)) session.aiAuthorized = true;
    const provider = providers[body.data.provider];
    const providerName = body.data.provider === "astra" ? "Astra" : "Jev";
    if (!provider.configured || !provider.decideObservation)
      return errorReply(
        reply,
        503,
        `${providerName} is not configured for adaptive comparisons.`,
      );
    if (session.adaptiveJobId) {
      const active = adaptiveJobs.get(session.adaptiveJobId);
      if (active && ["queued", "running"].includes(active.value.status))
        return errorReply(
          reply,
          409,
          "An adaptive comparison is already active for this session.",
        );
      session.adaptiveJobId = undefined;
    }
    if (globalAdaptiveJobs >= 2)
      return errorReply(reply, 429, "Adaptive comparison capacity reached.");
    pruneAdaptiveJobs(session.id);
    const decisionTimes = body.data.decisionTimes ?? [300, 900];
    const maximumProviderCalls = 10 * decisionTimes.length;
    const providerCallsPerMinute = body.data.provider === "astra" ? 2 : 12;
    const timeoutMinutes =
      body.data.provider === "astra"
        ? Math.min(
            20,
            Math.ceil(maximumProviderCalls / providerCallsPerMinute) + 5,
          )
        : Math.min(
            5,
            Math.ceil(maximumProviderCalls / providerCallsPerMinute) + 2,
          );
    const now = Date.now();
    const jobId = randomUUID();
    const internal: InternalAdaptiveJob = {
      sessionId: session.id,
      controller: new AbortController(),
      value: {
        jobId,
        status: "queued",
        provider: body.data.provider,
        createdAt: now,
        updatedAt: now,
        progress: {
          phase: "queued",
          completedPairs: 0,
          requestedDecisions: 0,
          completedDecisions: 0,
          simulationTime: 0,
        },
        bounds: {
          pairedSeeds: 10,
          decisionCheckpoints: decisionTimes.length,
          maximumProviderCalls,
          providerCallsPerMinute,
          timeoutMinutes,
        },
      },
    };
    adaptiveJobs.set(jobId, internal);
    session.adaptiveJobId = jobId;
    const accepted = structuredClone(internal.value);
    runAdaptiveJob(
      session,
      internal,
      {
        config: body.data.config as Partial<FactoryConfig> | undefined,
        decisionTimes,
      },
      body.data.provider,
      timeoutMinutes * 60_000,
    );
    return reply.code(202).send(accepted);
  });

  app.get(
    "/api/sessions/:id/adaptive-experiments/:jobId",
    async (request, reply) => {
      const session = authenticate(request, reply);
      if (!session) return;
      const { jobId } = (request.params ?? {}) as { jobId?: string };
      const job = jobId ? adaptiveJobs.get(jobId) : undefined;
      if (!job || job.sessionId !== session.id)
        return errorReply(reply, 404, "Adaptive comparison not found.");
      return job.value;
    },
  );

  app.delete(
    "/api/sessions/:id/adaptive-experiments/:jobId",
    async (request, reply) => {
      const session = authenticate(request, reply);
      if (!session) return;
      const { jobId } = (request.params ?? {}) as { jobId?: string };
      const job = jobId ? adaptiveJobs.get(jobId) : undefined;
      if (!job || job.sessionId !== session.id)
        return errorReply(reply, 404, "Adaptive comparison not found.");
      const cancelled =
        session.adaptiveJobId === jobId &&
        ["queued", "running"].includes(job.value.status) &&
        cancelAdaptiveJob(session, "requested");
      return reply.code(cancelled ? 202 : 200).send(job.value);
    },
  );

  // Serialize once per session revision of the stream, not once per viewer.
  function liveMessage(session: Session) {
    if (session.liveMessage?.sequence !== session.liveSequence) {
      session.liveMessage = { sequence: session.liveSequence, payload: JSON.stringify({
        type: "snapshot", sessionId: session.id, sequence: session.liveSequence,
        sentAt: Date.now(), snapshot: session.simulation.liveSnapshot(),
      }) };
    }
    return session.liveMessage!.payload;
  }

  app.get("/api/live", { websocket: true }, (socket) => {
    let session: Session | null = null;
    let lastSequence = -1;
    const authTimer = setTimeout(
      () => socket.close(1008, "Authentication required"),
      5000,
    );
    authTimer.unref();
    const snapshotTimer = setInterval(() => {
      if (
        session &&
        session.liveSequence > lastSequence &&
        socket.readyState === socket.OPEN
      ) {
        session.lastAccess = Date.now();
        lastSequence = session.liveSequence;
        if (socket.bufferedAmount < 512_000) socket.send(liveMessage(session));
      }
    }, tickMs);
    snapshotTimer.unref();
    socket.on("message", (raw) => {
      if (session) return;
      try {
        const auth = z
          .object({ id: z.string().uuid(), token: z.string().min(1) })
          .strict()
          .parse(JSON.parse(raw.toString()));
        const candidate = sessions.get(auth.id);
        if (!candidate || !secretMatches(auth.token, candidate.token))
          throw new Error("invalid");
        session = candidate;
        session.clients++;
        session.lastAccess = Date.now();
        clearTimeout(authTimer);
        lastSequence = session.liveSequence;
        if (socket.bufferedAmount < 512_000) socket.send(liveMessage(session));
      } catch {
        socket.close(1008, "Invalid authentication");
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(snapshotTimer);
      if (session) session.clients = Math.max(0, session.clients - 1);
    });
  });

  if (existsSync(resolve(webRoot, "index.html"))) {
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/"))
        return reply.sendFile("index.html");
      return errorReply(reply, 404, "Not found.");
    });
  }

  return app;
}
