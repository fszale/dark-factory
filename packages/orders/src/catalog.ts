import { ROBOTAXI_RECIPE } from "../../assets/src/design.ts";
import {
  VIRTUAL_CURRENCY,
  VIRTUAL_DISCLAIMER,
  type ListVehicleConfigsOutput,
} from "../../contracts/src/orders.ts";
import { PRICE_BOOK } from "./pricing.ts";

/**
 * The factory builds exactly one product. The catalog lists the values the
 * recipe can honor and, separately, values it cannot, so an agent learns the
 * boundary from a feasibility issue instead of a schema error.
 */
export interface CatalogOption {
  key: string;
  offered: Array<string | number>;
  notOffered: Array<{ value: string | number; note: string }>;
}
export interface CatalogModel {
  modelId: string;
  name: string;
  description: string;
  recipeId: string;
  recipeVersion: number;
  options: CatalogOption[];
}

export const CATALOG: readonly CatalogModel[] = [
  {
    modelId: "robotaxi-gold-two-seat",
    name: "Gold two-seat robotaxi (virtual)",
    description:
      "Brick-built gold robotaxi made from five parallel modules (front, rear, battery/floor, interior, exterior), joined late and inspected at end of line. Built in the simulation only.",
    recipeId: ROBOTAXI_RECIPE.id,
    recipeVersion: ROBOTAXI_RECIPE.version,
    options: [
      {
        key: "finish",
        offered: ["gold"],
        notOffered: [
          { value: "silver", note: "The recipe has gold exterior panels only." },
          { value: "black", note: "The recipe has gold exterior panels only." },
        ],
      },
      {
        key: "seats",
        offered: [2],
        notOffered: [
          { value: 4, note: "The interior module builds a two-seat cabin only." },
        ],
      },
    ],
  },
];

export function findModel(modelId: string) {
  return CATALOG.find((model) => model.modelId === modelId);
}

/** Default option values filled in for a model when the agent omits them. */
export function resolvedOptions(
  model: CatalogModel,
  options: Record<string, string | number>,
): Record<string, string | number> {
  const resolved: Record<string, string | number> = {};
  for (const option of model.options)
    resolved[option.key] = options[option.key] ?? option.offered[0];
  return resolved;
}

export function listVehicleConfigs(): ListVehicleConfigsOutput {
  return {
    priceBookVersion: PRICE_BOOK.id,
    models: CATALOG.map((model) => ({
      modelId: model.modelId,
      name: model.name,
      recipeId: model.recipeId,
      recipeVersion: model.recipeVersion,
      description: model.description,
      basePrice: {
        amount: PRICE_BOOK.unitPrice[model.modelId] ?? 0,
        currency: VIRTUAL_CURRENCY,
      },
      options: model.options.map((option) => ({
        key: option.key,
        values: [
          ...option.offered.map((value) => ({ value, offered: true, note: null })),
          ...option.notOffered.map(({ value, note }) => ({
            value,
            offered: false,
            note,
          })),
        ],
      })),
    })),
    virtual: true,
    disclaimer: VIRTUAL_DISCLAIMER,
  };
}
