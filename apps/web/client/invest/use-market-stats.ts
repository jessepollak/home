"use client";

import { useHomeQuery } from "@/client/query/query-client";
import { publicQuery } from "@/client/query/query-options";
import { publicResource } from "@/client/query/public-resource";
import { parseMarketStatsResponse, type MarketStats, type MarketStatsResponse } from "@/shared/invest/contracts/market-stats";

export function marketStatsOptions(assetId: string, enabled: boolean) {
  return publicQuery<MarketStatsResponse>({
    scope: "market-stats", key: [assetId],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const payload = parseMarketStatsResponse(await publicResource(`/api/market-prices/stats?assetId=${encodeURIComponent(assetId)}`, { signal }));
      if (!payload || payload.assetId !== assetId) throw new Error("Invalid market stats response");
      return payload;
    },
  });
}

export function useMarketStats(assetId: string, enabled: boolean): MarketStats | null {
  const query = useHomeQuery(marketStatsOptions(assetId, enabled));
  return enabled && query.data?.status === "ready" && !query.isError ? query.data.stats : null;
}
