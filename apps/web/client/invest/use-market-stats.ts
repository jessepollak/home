"use client";

import { useHomeQuery } from "@/client/query/query-client";
import { publicQuery } from "@/client/query/query-options";
import { publicResource } from "@/client/query/public-resource";
import type { InvestAsset } from "@/config/invest-assets";
import { parseMarketStatsResponse, type MarketStats, type MarketStatsResponse, type TokenRisk } from "@/shared/invest/contracts/market-stats";

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

export function useTokenRisk(asset: InvestAsset) {
  const query = useHomeQuery(marketStatsOptions(asset.id, asset.category !== "stock"));
  const risk = query.data?.assetId === asset.id ? query.data.risk : undefined;
  const boundRisk = risk && risk.chainId === asset.chainId &&
    risk.contractAddress === asset.contractAddress.toLowerCase() ? risk : undefined;
  const state: TokenRisk | { status: "loading" | "failed" } = query.isError
    ? boundRisk && (boundRisk.status === "ready" || boundRisk.status === "stale")
      ? { ...boundRisk, status: "stale" } : { status: "failed" }
    : boundRisk ?? (query.isPending && !query.data && !query.isFetched ? { status: "loading" } : { status: "failed" });
  return { ...state, retry: () => query.refetch(), refreshing: query.isFetching && query.data !== undefined };
}
