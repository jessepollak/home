import type { HoldingValue, HoldingValueUnpricedReason } from "./types";

const unpricedLabels: Record<HoldingValueUnpricedReason, string> = {
  "price-paused": "Paused",
  "price-stale": "Price delayed",
  "price-unavailable": "Value unavailable",
  "asset-removed": "No longer listed",
  "fx-unavailable": "Value unavailable",
  "below-market-gate": "Value unavailable",
  "no-quote-currency": "Value unavailable",
};

export function holdingValueContext(value: HoldingValue): string | undefined {
  if (value.status === "priced") return value.reference?.session === "closed" ? "Last close" : undefined;
  if (value.status === "unpriced") return unpricedLabels[value.reason];
  return "Value unavailable";
}
