import {
  VIRTUAL_CURRENCY,
  type DestinationZone,
  type LeadOption,
} from "../../contracts/src/orders.ts";

/**
 * Declared, versioned virtual price book. It is deliberately not derived from
 * the simulation's cost estimates, which are simulated observations; reusing
 * them would imply economics the project does not claim.
 */
export const PRICE_BOOK = {
  id: "pb-2026-10-v1",
  unitPrice: { "robotaxi-gold-two-seat": 1000 } as Record<string, number>,
  expeditePremiumPerUnit: 250,
  carrierPerUnit: {
    "zone-local": 20,
    "zone-metro": 40,
    "zone-regional": 80,
    "zone-remote": 120,
  } as Record<DestinationZone, number>,
} as const;

export const LEAD_OPTION_PRIORITY: Record<LeadOption, number> = {
  standard: 3,
  expedite: 2,
};

const money = (amount: number) => ({ amount, currency: VIRTUAL_CURRENCY });

export interface PriceLine {
  code: string;
  description: string;
  quantity: number;
  unitPrice: { amount: number; currency: typeof VIRTUAL_CURRENCY };
  total: { amount: number; currency: typeof VIRTUAL_CURRENCY };
}

/** Quote lines common to every lead option plus the expedite-only premium line. */
export function priceLines(
  modelId: string,
  quantity: number,
  zone: DestinationZone | null,
): PriceLine[] {
  const unit = PRICE_BOOK.unitPrice[modelId] ?? 0;
  const lines: PriceLine[] = [
    {
      code: `MODEL:${modelId}`,
      description: "Virtual vehicle, per unit",
      quantity,
      unitPrice: money(unit),
      total: money(unit * quantity),
    },
  ];
  if (zone) {
    const carrier = PRICE_BOOK.carrierPerUnit[zone];
    lines.push({
      code: `CARRIER:${zone}`,
      description: "Brickworks Virtual Freight, per unit",
      quantity,
      unitPrice: money(carrier),
      total: money(carrier * quantity),
    });
  }
  lines.push({
    code: "EXPEDITE_PREMIUM",
    description: "Expedite production priority, per unit (expedite lead option only)",
    quantity,
    unitPrice: money(PRICE_BOOK.expeditePremiumPerUnit),
    total: money(PRICE_BOOK.expeditePremiumPerUnit * quantity),
  });
  return lines;
}

export function leadOptionPrice(
  modelId: string,
  quantity: number,
  zone: DestinationZone | null,
  leadOption: LeadOption,
) {
  const unit = PRICE_BOOK.unitPrice[modelId] ?? 0;
  const carrier = zone ? PRICE_BOOK.carrierPerUnit[zone] : 0;
  const premium = leadOption === "expedite" ? PRICE_BOOK.expeditePremiumPerUnit : 0;
  return money((unit + carrier + premium) * quantity);
}
