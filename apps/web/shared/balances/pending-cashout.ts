import { PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";
import { baseUnitsToFraction, exactDecimalToFraction, multiplyFractions, roundFractionPreservingPositive } from "./math";
import type { BalancesSnapshot, ExactDecimal } from "./types";

export type PendingCashoutEscrow = { baseUnits: string };
export type PendingCashoutEstimate =
  | { state: "escrow"; baseUnits: string; partial: boolean }
  | { state: "indeterminate" }
  | { state: "unreadable" }
  | { state: "loading" }
  | null;

export function pricePendingCashout(snapshot: BalancesSnapshot, escrow: PendingCashoutEscrow): ExactDecimal | "unpriced" {
  const usdc = snapshot.holdings.find((holding) => holding.key === PORTFOLIO_USDC_ASSET_KEY &&
    holding.source === "registry" && holding.cashCurrency === "USD" && holding.decimals === 6);
  if (!snapshot.quoteCurrency || !usdc?.unitValue || usdc.unitValue.currency !== snapshot.quoteCurrency) return "unpriced";
  return roundFractionPreservingPositive(multiplyFractions(
    baseUnitsToFraction(escrow.baseUnits, 6), exactDecimalToFraction(usdc.unitValue.amount),
  ));
}
