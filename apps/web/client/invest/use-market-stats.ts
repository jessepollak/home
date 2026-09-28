"use client";

import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { publicResource } from "@/client/query/public-resource";
import { parseMarketStatsResponse, type MarketStats } from "@/shared/invest/contracts/market-stats";

export function useMarketStats(assetId: string, enabled: boolean): MarketStats | null {
  const query = useHomeQuery({
    queryKey: publicQueryKey("market-stats", assetId),
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const payload = parseMarketStatsResponse(await publicResource(`/api/market-prices/stats?assetId=${encodeURIComponent(assetId)}`, { signal }));
      if (!payload || payload.assetId !== assetId) throw new Error("Invalid market stats response");
      return payload;
    },
  });
  return enabled && query.data?.status === "ready" && !query.isError ? query.data.stats : null;
}
