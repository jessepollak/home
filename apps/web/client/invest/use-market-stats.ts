"use client";

import { replaceEqualDeep } from "@tanstack/react-query";
import { useHomeQuery } from "@/client/query/query-client";
import { publicQuery } from "@/client/query/query-options";
import { publicResource } from "@/client/query/public-resource";
import type { InvestAsset } from "@/config/invest-assets";
import { parseMarketStatsResponse, type MarketStats, type MarketStatsResponse, type TokenRisk } from "@/shared/invest/contracts/market-stats";

type CachedMarketStats = MarketStatsResponse & { retained?: true };
export type MarketStatsView = { stats: MarketStats; stale: { fetchedAt: string | null } | null };

export function marketStatsOptions(assetId: string, enabled: boolean) {
  return publicQuery<CachedMarketStats>({
    scope: "market-stats", key: [assetId],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    structuralSharing: (oldData, newData) => {
      const previous = parseMarketStatsResponse(oldData);
      const next = parseMarketStatsResponse(newData);
      const kept: unknown = previous?.status === "ready" && next?.status === "error" && next.assetId === previous.assetId
        ? { ...next, status: "ready", fetchedAt: previous.fetchedAt, stats: previous.stats, retained: true }
        : newData;
      return replaceEqualDeep(oldData, kept);
    },
    queryFn: async ({ signal }) => {
      const payload = parseMarketStatsResponse(await publicResource(`/api/market-prices/stats?assetId=${encodeURIComponent(assetId)}`, { signal }));
      if (!payload || payload.assetId !== assetId) throw new Error("Invalid market stats response");
      return payload;
    },
  });
}

export function useMarketStats(assetId: string, enabled: boolean): MarketStatsView | null {
  const query = useHomeQuery(marketStatsOptions(assetId, enabled));
  const data = query.data;
  if (!enabled || data?.status !== "ready" || data.assetId !== assetId) return null;
  return { stats: data.stats, stale: query.isError || data.retained ? { fetchedAt: data.fetchedAt } : null };
}

export function useTokenRisk(asset: InvestAsset) {
  const query = useHomeQuery(marketStatsOptions(asset.id, asset.category !== "stock"));
  const risk = query.data?.assetId === asset.id ? query.data.risk : undefined;
  const boundRisk = risk && risk.chainId === asset.chainId &&
    risk.contractAddress === asset.contractAddress.toLowerCase() ? risk : undefined;
  const state: TokenRisk | { status: "loading" | "failed" } = query.isError
    ? boundRisk && (boundRisk.status === "ready" || boundRisk.status === "partial" || boundRisk.status === "stale" || boundRisk.status === "stale-partial")
      ? { ...boundRisk, status: boundRisk.status === "partial" || boundRisk.status === "stale-partial" ? "stale-partial" : "stale" } : { status: "failed" }
    : boundRisk ?? (query.isPending && !query.data && !query.isFetched ? { status: "loading" } : { status: "failed" });
  return { ...state, retry: () => query.refetch(), refreshing: query.isFetching && query.data !== undefined };
}
