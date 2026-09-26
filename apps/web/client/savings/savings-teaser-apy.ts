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
  if (summary?.funded && (summary.apy.status === "available" || summary.apy.status === "stale")) {
    return `${formatExactSavingsApy(summary.apy.value)} APY`;
  }
  const rates = candidates.map((candidate) =>
    getSavingsRateState(candidate, {
      metadataFetchedAt: metadata.source.fetchedAt,
      metadataStale: metadata.stale,
      nowMs,
    }),
  );
  const known = rates.flatMap((rate) =>
    rate.status !== "unavailable" ? [rate.value] : [],
  );
  return known.length > 0
    ? `Up to ${formatPresentationPercentage(Math.max(...known))} APY`
    : null;
}
