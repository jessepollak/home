"use client";

import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
import { parseMarketStatsResponse, type MarketStats } from "@/shared/invest/contracts/market-stats";

export function useMarketStats(assetId: string, enabled: boolean): MarketStats | null {
  const query = useHomeQuery({
    queryKey: publicQueryKey("market-stats", assetId),
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/market-prices/stats?assetId=${encodeURIComponent(assetId)}`, {
        headers: { ...deploymentHeaders(), accept: "application/json" },
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Market stats request failed");
      const payload = parseMarketStatsResponse(await response.json());
      if (!payload || payload.assetId !== assetId) throw new Error("Invalid market stats response");
      return payload;
    },
  });
  return enabled && query.data?.status === "ready" && !query.isError ? query.data.stats : null;
}
