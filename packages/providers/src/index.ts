import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import { LINE_IDS } from "../../contracts/src/index.ts";
import type {
  DecisionAction,
  DecisionRecord,
  FactoryCommand,
  FactorySnapshot,
  LineId,
  ProviderStatus,
} from "../../contracts/src/index.ts";

export type ProviderId = "astra" | "jev";

export interface ProviderDecision {
  summary: string;
  commands: DecisionAction[];
  tokens: number;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly configured: boolean;
  /** Live adapters set this explicitly; injected test adapters default to fixture provenance. */
  readonly source?: "live-provider" | "test-fixture";
  readonly model?: string;
  decide(
    snapshot: FactorySnapshot,
    message?: string,
  ): Promise<ProviderDecision>;
  decideObservation?(
    observation: OperationalView,
    message?: string,
    signal?: AbortSignal,
  ): Promise<ProviderDecision>;
}

export class ProviderUnavailableError extends Error {
  constructor(provider: ProviderId) {
    super(`${provider} is not configured`);
    this.name = "ProviderUnavailableError";
  }
}

const allowedConfigValue = (value: unknown) => {
  if (typeof value !== "string") return false;
  const [key, raw, ...extra] = value.split(":");
  if (extra.length || raw === undefined) return false;
  if (key === "continuous") return raw === "true" || raw === "false";
  const number = Number(raw);
  if (!Number.isFinite(number)) return false;
  if (key === "releaseRate") return number >= 0.1 && number <= 3;
  if (key === "reorderPoint")
    return Number.isInteger(number) && number >= 1 && number <= 40;
  if (key === "deliverySize")
    return Number.isInteger(number) && number >= 1 && number <= 60;
  if (key === "deliveryLead") return number >= 1 && number <= 600;
  if (key === "dispatchDwell") return number >= 5 && number <= 3600;
  if (key === "orderSize")
    return Number.isInteger(number) && number >= 1 && number <= 10_000;
  if (key === "materialLoadingCapacity")
    return Number.isInteger(number) && number >= 1 && number <= 3;
  return false;
};

function experimentRequest(value: unknown) {
  if (typeof value !== "string") return null;
  const [line, profile, ...extra] = value.split(":");
  if (
    extra.length ||
    !LINE_IDS.includes(line as LineId) ||
    !["gentle", "normal", "fast"].includes(profile)
  )
    return null;
  return {
    line: line as LineId,
    profile: profile as "gentle" | "normal" | "fast",
  };
}

const allowedCommandSchema = z
  .object({
    type: z.enum([
      "start",
      "pause",
      "speed",
      "profile",
      "priority",
      "buffer",
      "repair",
      "config",
      "order-create",
      "order-priority",
      "experiment",
    ]),
    station: z
      .enum(["front", "rear", "battery", "interior", "exterior"])
      .nullable()
      .optional(),
    value: z
      .union([z.number().finite(), z.string().max(120), z.boolean()])
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((command, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (
      command.type === "speed" &&
      ![1, 2, 5, 10].includes(Number(command.value))
    )
      issue("Unsupported speed");
    if (
      command.type === "profile" &&
      (!command.station ||
        !["gentle", "normal", "fast"].includes(String(command.value)))
    )
      issue("Invalid profile command");
    if (
      command.type === "priority" &&
      (!command.station ||
        !Number.isInteger(command.value) ||
        Number(command.value) < 1 ||
        Number(command.value) > 5)
    )
      issue("Invalid priority command");
    if (
      command.type === "buffer" &&
      (!command.station ||
        !Number.isInteger(command.value) ||
        Number(command.value) < 1 ||
        Number(command.value) > 8)
    )
      issue("Invalid buffer command");
    if (
      command.type === "config" &&
      (!allowedConfigValue(command.value) || command.station)
    )
      issue("Invalid bounded config command");
    if (command.type === "experiment") {
      const request = experimentRequest(command.value);
      if (!request || (command.station && command.station !== request.line))
        issue("Invalid bounded experiment request");
    }
    if (command.type === "order-create") {
      const match =
        typeof command.value === "string"
          ? command.value.match(/^(\d+):([1-5])$/)
          : null;
      if (
        command.station ||
        !match ||
        Number(match[1]) < 1 ||
        Number(match[1]) > 1000
      )
        issue("Invalid bounded order request");
    }
    if (command.type === "order-priority") {
      const match =
        typeof command.value === "string"
          ? command.value.match(/^([^:]{1,100}):([1-5])$/)
          : null;
      if (command.station || !match) issue("Invalid order priority request");
    }
  });

const rawProviderCommandsSchema = z
  .array(allowedCommandSchema)
  .max(5)
  .superRefine((commands, context) => {
    if (commands.filter((command) => command.type === "experiment").length > 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one experiment is allowed",
      });
  });

const astraResponseSchema = z
  .object({
    summary: z.string().min(1).max(600),
    commands: rawProviderCommandsSchema,
  })
  .strict();

const normalizedProviderCommandSchema = z
  .object({
    id: z.string().min(1).max(120),
    type: z.enum([
      "start",
      "pause",
      "speed",
      "profile",
      "priority",
      "buffer",
      "repair",
      "config",
      "order-create",
      "order-priority",
      "experiment",
    ]),
    station: z
      .enum(["front", "rear", "battery", "interior", "exterior"])
      .optional(),
    value: z
      .union([z.number().finite(), z.string().max(120), z.boolean()])
      .optional(),
  })
  .strict()
  .superRefine((command, context) => {
    const { id: _, ...action } = command;
    const parsed = allowedCommandSchema.safeParse(action);
    if (!parsed.success)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid provider command",
      });
  });

const normalizedProviderCommandsSchema = z
  .array(normalizedProviderCommandSchema)
  .max(5)
  .superRefine((commands, context) => {
    if (commands.filter((command) => command.type === "experiment").length > 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one experiment is allowed",
      });
  });

const providerDecisionSchema = z
  .object({
    summary: z.string().min(1).max(600),
    commands: normalizedProviderCommandsSchema,
    tokens: z.number().int().nonnegative().finite(),
  })
  .strict();

export const validateProviderCommands = (input: unknown) =>
  rawProviderCommandsSchema.safeParse(input).success;
export const validateProviderDecision = (
  input: unknown,
): input is ProviderDecision => providerDecisionSchema.safeParse(input).success;

type PublicStation = {
  id: LineId;
  status: string;
  progress: number;
  stock: number;
  queue: number;
  profile: string;
  completed: number;
  rejects: number;
  temperature: number;
  vibration: number;
  currentAmps: number;
  fault: string | null;
};

/** A deliberately narrow view: hidden wear and future/internal random state never leave the server. */
export function operationalView(snapshot: FactorySnapshot) {
  const stations = Object.values(snapshot.stations).map(
    (station): PublicStation => ({
      id: station.id,
      status: station.status,
      progress: station.progress,
      stock: station.stock,
      queue: station.queue.length,
      profile: station.profile,
      completed: station.completed,
      rejects: station.rejects,
      temperature: station.temperature,
      vibration: station.vibration,
      currentAmps: station.currentAmps,
      fault: station.fault,
    }),
  );
  return {
    time: snapshot.time,
    running: snapshot.running,
    speed: snapshot.speed,
    mode: snapshot.mode,
    scenario: snapshot.config.scenario,
    configuration: {
      orderSize: snapshot.config.orderSize,
      continuous: snapshot.config.continuous,
      releaseRate: snapshot.config.releaseRate,
      reorderPoint: snapshot.config.reorderPoint,
      deliverySize: snapshot.config.deliverySize,
      deliveryLead: snapshot.config.deliveryLead,
      dispatchDwell: snapshot.config.dispatchDwell,
      materialPriority:
        snapshot.config.materialPriority ??
        Object.fromEntries(LINE_IDS.map((line) => [line, 3])),
      materialLoadingCapacity: snapshot.config.materialLoadingCapacity ?? 2,
    },
    stations,
    warehouse: snapshot.warehouse,
    parked: snapshot.vehicles.filter((vehicle) => vehicle.phase === "parked")
      .length,
    activeVehicles: snapshot.vehicles.length,
    metrics: {
      completed: snapshot.metrics.completed,
      dispatched: snapshot.metrics.dispatched,
      throughput: snapshot.metrics.throughput,
      yield: snapshot.metrics.yield,
      energy: snapshot.metrics.energy,
      dockWait: snapshot.metrics.dockWait,
      assemblyWait: snapshot.metrics.assemblyWait,
      parkingWait: snapshot.metrics.parkingWait,
    },
    activeFaults: snapshot.faults,
    orders: snapshot.orders.map((order) => ({
      id: order.id,
      quantity: order.quantity,
      completed: order.completed,
      priority: order.priority,
      status: order.status,
      createdAt: order.createdAt,
      source: order.source,
    })),
    recentEvents: snapshot.events
      .slice(-8)
      .map(({ time, type, entity, message }) => ({
        time,
        type,
        entity,
        message,
      })),
    recentExperiments: snapshot.decisions
      .filter((decision) => decision.experiment?.status === "completed")
      .slice(-3)
      .map((decision) => ({
        decisionId: decision.id,
        applicationTime: decision.applicationTime ?? decision.time,
        requestedProfile: decision.experiment!.requestedProfile,
        provenance: decision.experiment!.provenance,
        runs: decision.experiment!.runs ?? 0,
        completedAt: decision.experiment!.completedAt ?? decision.time,
        baseline: decision.experiment!.baseline ?? {},
        candidate: decision.experiment!.candidate ?? {},
        differences: decision.experiment!.differences ?? {},
        note: decision.experiment!.note,
      })),
  };
}
export type OperationalView = ReturnType<typeof operationalView>;

function commandId(provider: ProviderId, index: number) {
  return `${provider}-${index}-${randomUUID()}`;
}

function normalizeCommands(
  provider: ProviderId,
  commands: z.infer<typeof allowedCommandSchema>[],
): DecisionAction[] {
  return commands.map((command, index): DecisionAction => {
    if (command.type === "experiment")
      return {
        id: commandId(provider, index),
        type: "experiment",
        ...(command.station ? { station: command.station } : {}),
        value: String(command.value),
      };
    return {
      id: commandId(provider, index),
      type: command.type,
      ...(command.station ? { station: command.station } : {}),
      ...(command.value !== null && command.value !== undefined
        ? { value: command.value }
        : {}),
    } as FactoryCommand;
  });
}

export class AstraProvider implements ProviderAdapter {
  readonly id = "astra" as const;
  readonly source = "live-provider" as const;
  readonly model = "gpt-6-astra";
  readonly configured: boolean;
  private readonly client: OpenAI | null;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    this.configured = Boolean(apiKey);
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async decide(
    snapshot: FactorySnapshot,
    message = "Review the current operation and choose safe actions.",
  ): Promise<ProviderDecision> {
    return this.decideObservation(operationalView(snapshot), message);
  }

  async decideObservation(
    view: OperationalView,
    message = "Review the current operation and choose safe actions.",
    signal?: AbortSignal,
  ): Promise<ProviderDecision> {
    if (!this.client) throw new ProviderUnavailableError(this.id);
    const response = await this.client.responses.create(
      {
        model: "gpt-6-astra",
        max_output_tokens: 600,
        instructions:
          "You supervise a brick-module dark factory. Use only current operational data. Return JSON with a concise summary and up to five commands. Allowed commands: start, pause, speed, profile, priority, buffer, repair, config, order-create, order-priority, experiment. Never invent observations. Prefer holding state when evidence is weak. Start or pause without a station controls the whole factory; with a station it resumes or freezes only that station. For profile include station and value gentle, normal, or fast. Priority requires a station and integer value 1–5, where 1 receives material first. For speed use 1, 2, 5, or 10. Buffer requires a station and integer value 1–8. Repair may name a faulted station. Config has no station and uses one string value in key:value form: releaseRate:0.1–3, reorderPoint:integer 1–40, deliverySize:integer 1–60, deliveryLead:1–600 seconds, dispatchDwell:5–3600 seconds, orderSize:integer 1–10000, materialLoadingCapacity:integer 1–3, or continuous:true|false. Order-create has no station and value quantity:priority with quantity 1–1000 and priority 1–5. Order-priority has no station and value existing-order-id:priority; never invent an order ID. Experiment runs one bounded paired simulation without changing the live factory; use a value like front:gentle and optionally the matching station. Request at most one experiment, and do not claim it caused an outcome or apply its candidate profile in the same response. A later response may use recentExperiments as evidence and issue a separate profile command. When the operator message identifies an adaptive paired comparison, use only profile, priority, order-priority, buffer, repair, or config; do not start, pause, change speed, create orders, or request another experiment. Use null for station or value when a command does not need it.",
        input: JSON.stringify({ operatorMessage: message, state: view }),
        text: {
          format: {
            type: "json_schema",
            name: "factory_decision",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "commands"],
              properties: {
                summary: { type: "string" },
                commands: {
                  type: "array",
                  maxItems: 5,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["type", "station", "value"],
                    properties: {
                      type: {
                        type: "string",
                        enum: [
                          "start",
                          "pause",
                          "speed",
                          "profile",
                          "priority",
                          "buffer",
                          "repair",
                          "config",
                          "order-create",
                          "order-priority",
                          "experiment",
                        ],
                      },
                      station: {
                        anyOf: [
                          {
                            type: "string",
                            enum: [
                              "front",
                              "rear",
                              "battery",
                              "interior",
                              "exterior",
                            ],
                          },
                          { type: "null" },
                        ],
                      },
                      value: {
                        anyOf: [
                          { type: "number" },
                          { type: "string" },
                          { type: "boolean" },
                          { type: "null" },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { signal },
    );
    const parsed = astraResponseSchema.parse(JSON.parse(response.output_text));
    return {
      summary: parsed.summary,
      commands: normalizeCommands(this.id, parsed.commands),
      tokens:
        (response.usage?.input_tokens ?? 0) +
        (response.usage?.output_tokens ?? 0),
    };
  }
}

export class JevProvider implements ProviderAdapter {
  readonly id = "jev" as const;
  readonly source = "live-provider" as const;
  readonly model = "typesafe-system-one";
  readonly configured: boolean;
  private readonly client: TypeSafeClient | null;

  constructor(apiKey = process.env.TYPESAFE_API_KEY) {
    this.configured = Boolean(apiKey);
    this.client = apiKey
      ? new TypeSafeClient({ apiKey, logLevel: "off" })
      : null;
  }

  async decide(
    snapshot: FactorySnapshot,
    message = "Select the safest immediate response.",
  ): Promise<ProviderDecision> {
    return this.decideObservation(operationalView(snapshot), message);
  }

  async decideObservation(
    view: OperationalView,
    message = "Select the safest immediate response.",
    _signal?: AbortSignal,
  ): Promise<ProviderDecision> {
    if (!this.client) throw new ProviderUnavailableError(this.id);
    const response = await this.client.systemOne({
      state: { message, operation: view },
      questions: {
        action: choice("Choose one bounded operational action.", {
          hold: "Keep current settings because there is no clear reason to intervene.",
          gentle_stressed: "Set the most stressed line to gentle.",
          normal_stressed: "Set the most stressed line to normal.",
          repair_faulted: "Repair the first currently faulted line.",
          pause:
            "Pause only when current observations indicate unsafe operation.",
        }),
      },
    });
    const selected = response.answers.action.choice;
    const faulted = view.stations.find((station) => station.fault);
    const stressed = [...view.stations].sort(
      (a, b) =>
        b.temperature + b.vibration * 10 - (a.temperature + a.vibration * 10),
    )[0];
    const commands: FactoryCommand[] = [];
    if (selected === "gentle_stressed" && stressed)
      commands.push({
        id: commandId(this.id, 0),
        type: "profile",
        station: stressed.id,
        value: "gentle",
      });
    if (selected === "normal_stressed" && stressed)
      commands.push({
        id: commandId(this.id, 0),
        type: "profile",
        station: stressed.id,
        value: "normal",
      });
    if (selected === "repair_faulted" && faulted)
      commands.push({
        id: commandId(this.id, 0),
        type: "repair",
        station: faulted.id,
      });
    if (selected === "pause")
      commands.push({ id: commandId(this.id, 0), type: "pause" });
    const summary =
      selected === "repair_faulted" && !faulted
        ? "Held state because no station currently reports a fault."
        : `Jev selected ${selected.replaceAll("_", " ")}.`;
    return {
      summary,
      commands,
      tokens: response.usage.input_tokens + response.usage.output_tokens,
    };
  }
}

export interface ProviderSet {
  astra: ProviderAdapter;
  jev: ProviderAdapter;
  status(accessRequired?: boolean): ProviderStatus;
}

export function createProviderSet(
  overrides: Partial<Record<ProviderId, ProviderAdapter>> = {},
): ProviderSet {
  const astra = overrides.astra ?? new AstraProvider();
  const jev = overrides.jev ?? new JevProvider();
  return {
    astra,
    jev,
    status(accessRequired = false) {
      return {
        astra: {
          configured: astra.configured,
          status: astra.configured ? "configured" : "not configured",
        },
        jev: {
          configured: jev.configured,
          status: jev.configured ? "configured" : "not configured",
        },
        accessRequired,
      };
    },
  };
}

export function decisionRecord(
  provider: ProviderId,
  decision: Omit<ProviderDecision, "commands"> & { commands: FactoryCommand[] },
  snapshot: FactorySnapshot,
  latency: number,
  status: DecisionRecord["status"],
): DecisionRecord {
  return {
    id: `decision-${provider}-${randomUUID()}`,
    provider,
    time: snapshot.time,
    summary: decision.summary,
    status,
    latency,
    commands: decision.commands,
    tokens: decision.tokens,
    revision: snapshot.revision,
  };
}
