import type { RegionId } from "@/config/regions";
import {
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  type SavingsPortfolioSummary,
} from "./portfolio-summary";

export function savingsTeaserBalanceLabel({
  summary,
  savedSubtotal,
  regionId,
}: {
  summary: SavingsPortfolioSummary | null;
  savedSubtotal: string | null;
  regionId: RegionId;
}): string {
  if (savedSubtotal) return savedSubtotal;
  if (summary?.balance.status !== "available") return "—";
  return formatUsdStablecoinAmount(
    summary.balance.totalBaseUnits,
    summary.balance.asset.decimals,
    regionId,
  );
}

export function savingsTeaserApyLabel({
  summary,
  candidates,
  metadata,
  nowMs,
}: {
  summary: SavingsPortfolioSummary | null;
  candidates: readonly MorphoVaultCandidate[];
  metadata: MorphoVaultsResult;
  nowMs: number;
}): string | null {
  if (summary?.funded && summary.apy.status === "available") {
    return `${formatExactSavingsApy(summary.apy.value)} APY`;
  }
  if (summary?.funded && summary.apy.status === "stale") return "APY stale";

  const rates = candidates.map((candidate) =>
    getSavingsRateState(candidate, {
      metadataFetchedAt: metadata.source.fetchedAt,
      metadataStale: metadata.stale,
      nowMs,
    }),
  );
  const available = rates.flatMap((rate) =>
    rate.status === "available" ? [rate.value] : [],
  );
  if (available.length > 0) {
    return `Up to ${formatPresentationPercentage(Math.max(...available))} APY`;
  }
  if (rates.some((rate) => rate.status === "stale")) return "APY stale";
  return rates.length > 0 ? "APY unavailable" : null;
}
