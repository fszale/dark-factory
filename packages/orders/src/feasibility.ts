import { LINE_IDS, LINE_META, type FactorySnapshot } from "../../contracts/src/index.ts";
import { ROBOTAXI_RECIPE } from "../../assets/src/design.ts";
import {
  DESTINATION_ZONES,
  type DestinationZone,
  type FeasibilityIssue,
  type VehicleConfigInput,
} from "../../contracts/src/orders.ts";
import { findModel } from "./catalog.ts";

export const ORDER_MAX_QUANTITY = 3;
export const FLOOR_MAX_ACTIVE_AGENT_ORDERS = 10;
export const ENGINE_MAX_ACTIVE_ORDERS = 20;

export interface FeasibilityInput {
  config: VehicleConfigInput;
  quantity: number;
  destinationZone: string;
  snapshot: FactorySnapshot;
  agentActiveOrders: number;
  agentMaxActiveOrders: number;
  floorActiveAgentOrders: number;
  floorMaxActiveAgentOrders?: number;
  intakePaused: boolean;
}

const issue = (
  value: Omit<FeasibilityIssue, "measured" | "limit" | "unit" | "suggestion"> &
    Partial<FeasibilityIssue>,
): FeasibilityIssue => ({
  measured: null,
  limit: null,
  unit: null,
  suggestion: null,
  ...value,
});

export function isZone(value: string): value is DestinationZone {
  return (DESTINATION_ZONES as readonly string[]).includes(value);
}

/**
 * Feasibility is the compiler: every refusal names a code, the feature it
 * concerns, the measured value, the limit, and a machine-actionable suggestion.
 * Uses only operational observations (no wear, seed or random state).
 */
export function checkFeasibility(input: FeasibilityInput): FeasibilityIssue[] {
  const issues: FeasibilityIssue[] = [];
  const model = findModel(input.config.modelId);
  if (!model)
    issues.push(
      issue({
        code: "MODEL_UNKNOWN",
        severity: "error",
        featureRef: "config.modelId",
        message: `Model "${input.config.modelId.slice(0, 60)}" is not in the catalog.`,
        suggestion: "Use modelId robotaxi-gold-two-seat (see list_vehicle_configs).",
      }),
    );
  else
    for (const [key, value] of Object.entries(input.config.options)) {
      const option = model.options.find((candidate) => candidate.key === key);
      if (!option) {
        issues.push(
          issue({
            code: "OPTION_NOT_OFFERED",
            severity: "error",
            featureRef: `config.options.${key.slice(0, 40)}`,
            message: `Option "${key.slice(0, 30)}" is not configurable on ${model.modelId}.`,
            suggestion: `Configurable options: ${model.options.map((o) => o.key).join(", ")}.`,
          }),
        );
        continue;
      }
      if (!option.offered.includes(value))
        issues.push(
          issue({
            code: "OPTION_NOT_OFFERED",
            severity: "error",
            featureRef: `config.options.${key}`,
            measured: typeof value === "number" ? value : null,
            message: `${key}=${String(value).slice(0, 30)} cannot be built by recipe ${model.recipeId}.`,
            suggestion: `Offered ${key} values: ${option.offered.join(", ")}.`,
          }),
        );
    }
  if (input.quantity > ORDER_MAX_QUANTITY)
    issues.push(
      issue({
        code: "QUANTITY_ABOVE_LIMIT",
        severity: "error",
        featureRef: "quantity",
        measured: input.quantity,
        limit: ORDER_MAX_QUANTITY,
        unit: "units",
        message: `At most ${ORDER_MAX_QUANTITY} units per order.`,
        suggestion: `Split into orders of ${ORDER_MAX_QUANTITY} or fewer units.`,
      }),
    );
  if (!isZone(input.destinationZone))
    issues.push(
      issue({
        code: "ZONE_UNKNOWN",
        severity: "error",
        featureRef: "destinationZone",
        message: `Destination zone "${input.destinationZone.slice(0, 40)}" is not served.`,
        suggestion: `Use one of ${DESTINATION_ZONES.join(", ")}.`,
      }),
    );
  if (input.agentActiveOrders >= input.agentMaxActiveOrders)
    issues.push(
      issue({
        code: "AGENT_ORDER_CAP",
        severity: "error",
        featureRef: "agent",
        measured: input.agentActiveOrders,
        limit: input.agentMaxActiveOrders,
        unit: "orders",
        message: "This agent already has the maximum number of non-terminal orders.",
        suggestion: "Wait for an order to be delivered or cancel one before quoting again.",
      }),
    );
  const floorCap = input.floorMaxActiveAgentOrders ?? FLOOR_MAX_ACTIVE_AGENT_ORDERS;
  const engineOrders = input.snapshot.orders.length;
  if (input.floorActiveAgentOrders >= floorCap || engineOrders >= ENGINE_MAX_ACTIVE_ORDERS)
    issues.push(
      issue({
        code: "FLOOR_ORDER_SLOTS_FULL",
        severity: "error",
        featureRef: "floor",
        measured:
          input.floorActiveAgentOrders >= floorCap
            ? input.floorActiveAgentOrders
            : engineOrders,
        limit: input.floorActiveAgentOrders >= floorCap ? floorCap : ENGINE_MAX_ACTIVE_ORDERS,
        unit: "orders",
        message: "The order floor has no free order slots right now.",
        suggestion: "Retry after an active order completes.",
      }),
    );
  if (input.intakePaused)
    issues.push(
      issue({
        code: "ORDER_DESK_PAUSED",
        severity: "error",
        featureRef: "floor",
        message: "The operator has paused order intake. Reads and tracking continue.",
        suggestion: "Retry later; existing orders keep progressing.",
      }),
    );
  const faults = input.snapshot.faults;
  const site: Array<[keyof typeof faults, FeasibilityIssue["code"], string]> = [
    ["assembly", "ASSEMBLY_OUTAGE_ACTIVE", "Final assembly outage is active; joining is frozen."],
    ["supply", "SUPPLY_HOLD_ACTIVE", "Supplier deliveries are held at the receiving gate."],
    ["dispatch", "DISPATCH_BLOCKAGE_ACTIVE", "Customer dispatch is blocked."],
    ["congestion", "CONGESTION_ACTIVE", "Internal kit transport is congested."],
  ];
  for (const [key, code, message] of site)
    if (faults[key])
      issues.push(
        issue({
          code,
          severity: "warning",
          featureRef: `site:${key}`,
          message,
          suggestion: "Lead time is at risk until an operator repairs the site.",
        }),
      );
  for (const line of LINE_IDS) {
    const station = input.snapshot.stations[line];
    if (station.status === "faulted" || station.status === "maintenance")
      issues.push(
        issue({
          code: "STATION_FAULTED",
          severity: "warning",
          featureRef: `line:${line}`,
          message: `${LINE_META[line].name} is ${station.status}.`,
          suggestion: "Lead time is at risk until the station returns to service.",
        }),
      );
    else if (station.status === "paused")
      issues.push(
        issue({
          code: "STATION_PAUSED",
          severity: "warning",
          featureRef: `line:${line}`,
          message: `${LINE_META[line].name} is operator-paused.`,
          suggestion: "Lead time is at risk until the operator resumes the station.",
        }),
      );
    const kits = ROBOTAXI_RECIPE.modules.find((m) => m.line === line)?.kits ?? 1;
    const available = input.snapshot.warehouse[line] + station.stock;
    const needed = kits * Math.min(input.quantity, ORDER_MAX_QUANTITY);
    if (available < needed)
      issues.push(
        issue({
          code: "LOW_LINE_STOCK",
          severity: "info",
          featureRef: `line:${line}`,
          measured: available,
          limit: needed,
          unit: "kits",
          message: `${LINE_META[line].name} has fewer kits on hand than the order needs; replenishment is automatic.`,
          suggestion: null,
        }),
      );
  }
  return issues;
}

export const hasErrors = (issues: FeasibilityIssue[]) =>
  issues.some((value) => value.severity === "error");
