import { formatPresentationPercentage } from "@/shared/formatting";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  type SavingsPortfolioSummary,
} from "./portfolio-summary";

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
