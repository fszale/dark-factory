import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  commandSchema,
  DEFAULT_CONFIG,
  type FactoryCommand,
  type FactoryConfig,
} from "../../contracts/src/index.ts";
import { operationalView } from "../../providers/src/index.ts";
import { FactorySimulation } from "./index.ts";

export type AdaptiveObservation = ReturnType<typeof operationalView>;
export interface AdaptiveDecisionRequest {
  seed: number;
  checkpoint: number;
  simulationTime: number;
  revision: number;
  epoch: number;
  observation: AdaptiveObservation;
  signal: AbortSignal;
}
export interface AdaptiveProposal {
  decisionId?: string;
  model?: string;
  provider: "astra" | "jev";
  source: "live-provider" | "test-fixture";
  summary: string;
  commands: FactoryCommand[];
  tokens: number;
}
export interface AdaptiveComparisonInput {
  /** Both policies begin with precisely this configuration and the same paired seed. */
  config?: Partial<FactoryConfig>;
  /** Exactly ten distinct nonnegative integer seeds. */
  seeds?: number[];
  /** One to three strictly increasing checkpoints in [0, 1800). Defaults to 300 and 900. */
  decisionTimes?: number[];
}
export interface AdaptiveProgress {
  phase:
    | "pair-started"
    | "decision-requested"
    | "decision-completed"
    | "pair-completed";
  seed: number;
  completedPairs: number;
  requestedDecisions: number;
  completedDecisions: number;
  simulationTime: number;
}
export interface AdaptiveOptions {
  /** Server must authorize, rate-limit, reserve global tokens, and meter this boundary. No raw provider client belongs in this runner. */
  decide: (request: AdaptiveDecisionRequest) => Promise<AdaptiveProposal>;
  signal?: AbortSignal;
  decisionTimeoutMs?: number;
  onProgress?: (progress: AdaptiveProgress) => void;
}
const METRICS = [
  "completed",
  "dispatched",
  "throughput",
  "yield",
  "energy",
  "materialCost",
  "maintenanceCost",
  "costPerVehicle",
  "leadTime",
  "downtime",
  "dockWait",
  "assemblyWait",
  "parkingWait",
  "roadWait",
  "receivingConservationDelta",
  "sortingTime",
] as const;
const proposalSchema = z
  .object({
    decisionId: z.string().min(1).max(120).optional(),
    model: z.string().min(1).max(120).optional(),
    provider: z.enum(["astra", "jev"]),
    source: z.enum(["live-provider", "test-fixture"]),
    summary: z.string().max(4000),
    commands: z.array(commandSchema).max(6),
    tokens: z.number().int().nonnegative().max(100_000),
  })
  .strict();
const operationalTypes = new Set([
  "profile",
  "priority",
  "order-priority",
  "buffer",
  "repair",
  "config",
]);
const configLimits: Record<string, [number, number]> = {
  releaseRate: [0.1, 3],
  reorderPoint: [1, 40],
  deliverySize: [1, 60],
  deliveryLead: [1, 600],
  dispatchDwell: [5, 3600],
  materialLoadingCapacity: [1, 3],
};
export interface AdaptiveTrace {
  decisionId: string;
  model?: string;
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
  observation: AdaptiveObservation;
  actions: Array<{
    command: FactoryCommand;
    appliedCommand?: FactoryCommand;
    ok: boolean;
    message: string;
    revision: number;
  }>;
}
export class AdaptiveComparisonError extends Error {
  constructor(
    message: string,
    readonly progress: {
      completedPairs: number;
      requestedDecisions: number;
      completedDecisions: number;
    },
  ) {
    super(message);
    this.name = "AdaptiveComparisonError";
  }
}
function isEligible(command: FactoryCommand) {
  if (!operationalTypes.has(command.type)) return false;
  if (command.type !== "config") return true;
  if (typeof command.value !== "string") return false;
  const [key, raw, ...rest] = command.value.split(":"),
    limits = configLimits[key];
  return (
    !rest.length &&
    Boolean(limits) &&
    raw !== "" &&
    Number.isFinite(Number(raw)) &&
    Number(raw) >= limits[0] &&
    Number(raw) <= limits[1]
  );
}
function metrics(sim: FactorySimulation): Record<string, number> {
  const values = sim.snapshot().metrics;
  return Object.fromEntries(
    METRICS.map((key) => [key, Number.isFinite(values[key]) ? values[key] : 0]),
  );
}
/** Async, bounded, adaptive comparison. No API keys, provider construction, or budget bypass exists here. */
export async function adaptivePairedExperiment(
  input: AdaptiveComparisonInput,
  options: AdaptiveOptions,
) {
  const seeds = [
    ...(input.seeds ?? Array.from({ length: 10 }, (_, i) => 10_001 + i)),
  ];
  const decisionTimes = [...(input.decisionTimes ?? [300, 900])];
  const initialConfig = structuredClone(input.config ?? {});
  if (
    seeds.length !== 10 ||
    new Set(seeds).size !== 10 ||
    seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)
  )
    throw new Error(
      "Adaptive comparisons require ten distinct nonnegative integer seeds",
    );
  if (
    decisionTimes.length < 1 ||
    decisionTimes.length > 3 ||
    decisionTimes.some(
      (t, i) =>
        !Number.isFinite(t) ||
        t < 0 ||
        t >= 1800 ||
        (i > 0 && t <= decisionTimes[i - 1]),
    )
  )
    throw new Error(
      "Select one to three increasing simulation checkpoints before 1800 seconds",
    );
  const timeoutMs = options.decisionTimeoutMs ?? 90_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000)
    throw new Error(
      "Decision timeout must be between 1000 and 120000 milliseconds",
    );
  const trace: AdaptiveTrace[] = [],
    perSeed: Array<{
      seed: number;
      baseline: Record<string, number>;
      candidate: Record<string, number>;
      differences: Record<string, number>;
      appliedActions: number;
      rejectedActions: number;
    }> = [];
  let requestedDecisions = 0,
    completedDecisions = 0;
  const fail = (message: string) =>
    new AdaptiveComparisonError(message, {
      completedPairs: perSeed.length,
      requestedDecisions,
      completedDecisions,
    });
  const cancelled = () => {
    if (options.signal?.aborted)
      throw fail(
        "Adaptive comparison cancelled; no further decisions will be requested",
      );
  };
  const progress = (
    phase: AdaptiveProgress["phase"],
    seed: number,
    simulationTime: number,
  ) =>
    options.onProgress?.({
      phase,
      seed,
      simulationTime,
      completedPairs: perSeed.length,
      requestedDecisions,
      completedDecisions,
    });
  const delta = (a: Record<string, number>, b: Record<string, number>) =>
    Object.fromEntries(METRICS.map((key) => [key, b[key] - a[key]]));
  for (const seed of seeds) {
    cancelled();
    progress("pair-started", seed, 0);
    const config = {
      ...DEFAULT_CONFIG,
      ...initialConfig,
      seed,
      profiles: { ...DEFAULT_CONFIG.profiles, ...initialConfig.profiles },
    };
    const baselineSim = new FactorySimulation(config),
      candidateSim = new FactorySimulation(config);
    baselineSim.command({ id: `baseline-start-${seed}`, type: "start" });
    candidateSim.command({ id: `candidate-start-${seed}`, type: "start" });
    baselineSim.advance(1800);
    let appliedActions = 0,
      rejectedActions = 0;
    for (const [checkpoint, at] of decisionTimes.entries()) {
      cancelled();
      candidateSim.advance(at - candidateSim.snapshot().time);
      const state = candidateSim.snapshot(),
        observation = structuredClone(operationalView(state));
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      requestedDecisions++;
      progress("decision-requested", seed, at);
      const started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let proposal: AdaptiveProposal;
      try {
        proposal = proposalSchema.parse(
          await Promise.race([
            Promise.resolve().then(() =>
              options.decide({
                seed,
                checkpoint,
                simulationTime: at,
                revision: state.revision,
                epoch: state.epoch,
                observation: structuredClone(observation),
                signal: controller.signal,
              }),
            ),
            new Promise<never>((_, reject) => {
              controller.signal.addEventListener(
                "abort",
                () => reject(new Error("Decision cancelled")),
                { once: true },
              );
              timer = setTimeout(() => {
                reject(new Error("Provider decision timed out"));
                controller.abort();
              }, timeoutMs);
            }),
          ]),
        );
      } catch (error) {
        throw fail(
          error instanceof z.ZodError
            ? "Provider returned an invalid adaptive decision"
            : options.signal?.aborted
              ? "Adaptive comparison cancelled"
              : "Adaptive decision unavailable; comparison stopped without policy substitution",
        );
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      }
      cancelled();
      completedDecisions++;
      const actions: AdaptiveTrace["actions"] = [];
      for (const [index, command] of proposal.commands.entries()) {
        let message: string | undefined;
        if (!isEligible(command))
          message =
            "Command is outside the bounded manufacturing-policy comparison";
        else if (
          (command.revision !== undefined &&
            command.revision !== state.revision) ||
          (command.epoch !== undefined && command.epoch !== state.epoch)
        )
          message = "Decision references a stale simulation state";
        if (message) {
          rejectedActions++;
          actions.push({
            command,
            ok: false,
            message,
            revision: candidateSim.snapshot().revision,
          });
          continue;
        }
        const appliedCommand = {
          ...command,
          id: `adaptive-${seed}-${checkpoint}-${index}`,
          revision: candidateSim.snapshot().revision,
          epoch: state.epoch,
        };
        const result = candidateSim.command(appliedCommand);
        if (result.ok) appliedActions++;
        else rejectedActions++;
        actions.push({ command, appliedCommand, ...result });
      }
      trace.push({
        decisionId: proposal.decisionId ?? `adaptive-${seed}-${checkpoint}`,
        ...(proposal.model ? { model: proposal.model } : {}),
        seed,
        checkpoint,
        simulationTime: at,
        revision: state.revision,
        epoch: state.epoch,
        provider: proposal.provider,
        source: proposal.source,
        summary: proposal.summary,
        tokens: proposal.tokens,
        latencyMs: performance.now() - started,
        observation,
        actions,
      });
      progress("decision-completed", seed, at);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    candidateSim.advance(1800 - candidateSim.snapshot().time);
    const baseline = metrics(baselineSim),
      candidate = metrics(candidateSim);
    perSeed.push({
      seed,
      baseline,
      candidate,
      differences: delta(baseline, candidate),
      appliedActions,
      rejectedActions,
    });
    progress("pair-completed", seed, 1800);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const average = (rows: Record<string, number>[]) =>
    Object.fromEntries(
      METRICS.map((key) => [
        key,
        rows.reduce((sum, row) => sum + row[key], 0) / rows.length,
      ]),
    );
  const baseline = average(perSeed.map((row) => row.baseline)),
    candidate = average(perSeed.map((row) => row.candidate)),
    differences = delta(baseline, candidate);
  const deviation = (
    rows: Record<string, number>[],
    means: Record<string, number>,
  ) =>
    Object.fromEntries(
      METRICS.map((key) => [
        key,
        Math.sqrt(
          rows.reduce((sum, row) => sum + (row[key] - means[key]) ** 2, 0) /
            rows.length,
        ),
      ]),
    );
  const live = trace.every((item) => item.source === "live-provider");
  return {
    status: "completed" as const,
    completedPairs: perSeed.length,
    providers: [...new Set(trace.map((item) => item.provider))],
    models: [
      ...new Set(trace.flatMap((item) => (item.model ? [item.model] : []))),
    ],
    sourceDecisionIds: trace.map((item) => item.decisionId),
    name: live
      ? "Adaptive live AI comparison"
      : "Adaptive comparison — test fixtures",
    runs: 10,
    seeds: [...seeds],
    simulatedDuration: 1800,
    decisionTimes: [...decisionTimes],
    policySource: live
      ? ("live-adaptive-ai" as const)
      : ("adaptive-test-fixture" as const),
    baseline,
    candidate,
    differences,
    perSeed,
    standardDeviation: {
      baseline: deviation(
        perSeed.map((row) => row.baseline),
        baseline,
      ),
      candidate: deviation(
        perSeed.map((row) => row.candidate),
        candidate,
      ),
      differences: deviation(
        perSeed.map((row) => row.differences),
        differences,
      ),
    },
    baselineConfig: structuredClone(initialConfig),
    candidateConfig: structuredClone(initialConfig),
    trace,
    requestedDecisions,
    completedDecisions,
    tokens: trace.reduce((sum, item) => sum + item.tokens, 0),
    note: `Ten paired seeds each run for 1,800 simulated seconds from identical configurations. Candidate decisions observe the candidate's evolving state at ${decisionTimes.join(", ")} seconds; baseline receives no decisions. ${live ? "The authorized server callback reports live provider provenance." : "Injected test fixtures are not live AI evidence."} Variation and regressions are retained; simulated results do not establish physical-factory performance.`,
  };
}
export type AdaptiveExperimentResult = Awaited<
  ReturnType<typeof adaptivePairedExperiment>
>;

export type AdaptiveComparisonResult = AdaptiveExperimentResult;
