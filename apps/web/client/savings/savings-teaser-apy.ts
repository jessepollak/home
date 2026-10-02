import type { RegionId } from "@/config/regions";
import { depositOffered } from "@/client/cash/save-offering";
import { formatPresentationPercentage } from "@/shared/formatting";
import type { ProductOffering } from "@/shared/operator-settings/products";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  type SavingsPortfolioSummary,
} from "./portfolio-summary";

export function savingsTeaserApyLabel({
  regionId,
  summary,
  offering,
  candidates,
  metadata,
  nowMs,
}: {
  regionId: RegionId;
  summary: SavingsPortfolioSummary | null;
  offering: ProductOffering;
  candidates: readonly MorphoVaultCandidate[];
  metadata: MorphoVaultsResult;
  nowMs: number;
}): string | null {
  if (summary?.funded && (summary.apy.status === "available" || summary.apy.status === "stale")) {
    return `${formatExactSavingsApy(summary.apy.value, regionId)} APY`;
  }
  if (summary && (summary.funded || summary.balance.status === "unavailable")) return null;
  const rates = candidates.filter((candidate) => depositOffered(offering, candidate)).map((candidate) =>
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
    ? `Up to ${formatPresentationPercentage(Math.max(...known), regionId)} APY`
    : null;
}
