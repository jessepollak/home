"use client";

import { keepPreviousData } from "@tanstack/react-query";
import type { RegionId } from "@/config/regions";
import { isVerifiedPortfolioSession } from "@/client/portfolio/parse";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { parsePortfolioValuationSnapshot } from "@/shared/portfolio/parse-valuation";
import type {
  FetchPortfolioValuation,
  PortfolioValuationSnapshot,
  PortfolioValuationState,
  VerifiedPortfolioValuationSession,
} from "@/shared/portfolio/valuation-state";
import { dataOwnerKey as portfolioOwnerKey } from "@/client/account/owner-keys";

type PortfolioValuationQuerySession = VerifiedPortfolioValuationSession & {
  accountProvider?: string;
};

export const valuationStaleTimeMs = 15_000;

export function usePortfolioValuation(
  session: PortfolioValuationQuerySession | null,
  region: RegionId,
  fetchValuation: FetchPortfolioValuation,
): PortfolioValuationState & { revalidating?: true } {
  const validSession = isVerifiedPortfolioSession(session) ? session : null;
  const ownerKey = validSession ? portfolioOwnerKey(validSession) : null;
  const query = useHomeQuery<PortfolioValuationSnapshot>({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "valuation", region)
      : ["unauthenticated", "valuation-disabled", region],
    enabled: ownerKey !== null,
    staleTime: valuationStaleTimeMs,
    retry: false,
    refetchOnWindowFocus: true,
    // The response includes optional recognized-token rows. Keep this query in
    // memory so those wallet-specific catalog matches are never dehydrated.
    meta: ownerKey ? ownerQueryMeta(ownerKey, "memory") : undefined,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[0] === ownerKey
        ? keepPreviousData(previousData)
        : undefined,
    queryFn: async ({ signal }) => {
      if (!validSession) throw new Error("Portfolio valuation is unavailable.");
      return parsePortfolioValuationSnapshot(
        await fetchValuation(region, signal),
        validSession,
        region,
      );
    },
    select: (snapshot) => snapshot,
  });

  if (!ownerKey) return { status: "unavailable", snapshot: null, error: null };
  if (query.isPending) return { status: "loading", snapshot: null, error: null };
  if (query.isError) {
    return {
      status: "error",
      snapshot: null,
      error: "portfolio-valuation-unavailable",
    };
  }
  return {
    status: "ready",
    snapshot: query.data,
    error: null,
    ...(query.isFetching ? { revalidating: true as const } : {}),
  };
}
