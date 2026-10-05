"use client";

import { hashKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { browserHomeQueryClient, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { publicQuery } from "@/client/query/query-options";
import { publicResource } from "@/client/query/public-resource";
import { queryViewState } from "@/client/query/query-view-state";
import {
  MARKET_HISTORY_PRIORITY_HEADER,
  parseHistoryResponse,
  type MarketPriceHistoryPoint,
  type MarketPriceHistorySource,
  type MarketPriceHistoryCoverage,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/contracts/market-price-history";

const HISTORY_ENDPOINT = "/api/market-prices/history";

const speculativeFetches = new Map<string, symbol>();

type HistoryMetadata = { source: MarketPriceHistorySource | null; coverage?: MarketPriceHistoryCoverage; asOf: number };

export type PriceHistoryState =
  | { status: "loading"; points: readonly MarketPriceHistoryPoint[] }
  | ({ status: "ready"; points: readonly MarketPriceHistoryPoint[] } & HistoryMetadata)
  | ({ status: "stale"; points: readonly MarketPriceHistoryPoint[] } & HistoryMetadata)
  | ({ status: "empty"; points: readonly MarketPriceHistoryPoint[] } & HistoryMetadata)
  | { status: "error"; points: readonly MarketPriceHistoryPoint[] };

async function fetchHistory(
  assetId: string,
  range: MarketPriceRange,
  speculative: boolean,
  signal: AbortSignal,
): Promise<MarketPriceHistoryResponse> {
  const payload = parseHistoryResponse(await publicResource(
    `${HISTORY_ENDPOINT}?assetId=${encodeURIComponent(assetId)}&range=${encodeURIComponent(range)}`,
    { signal, headers: speculative ? { [MARKET_HISTORY_PRIORITY_HEADER]: "prefetch" } : undefined },
  ));
  if (payload?.status === "error" || payload?.status === "unavailable") {
    throw new Error("History request failed");
  }
  if (!payload || payload.assetId !== assetId || payload.range !== range) {
    throw new Error("Invalid history response");
  }
  if (payload.provider === "chainlink" && payload.status === "ready" && payload.points.length < 2
    && payload.coverage?.gaps.some((gap) => gap.reason === "read-failed" || gap.reason === "incomplete")) {
    throw new Error("History request failed");
  }
  return payload;
}

export function priceHistoryOptions(assetId: string, range: MarketPriceRange, options: { speculative?: boolean } = {}) {
  const speculative = options.speculative === true;
  const queryHash = hashKey(publicQueryKey("price-history", assetId, range));
  return publicQuery<MarketPriceHistoryResponse>({
    scope: "price-history", key: [assetId, range],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const token = Symbol(queryHash);
      if (speculative) speculativeFetches.set(queryHash, token);
      try {
        return await fetchHistory(assetId, range, speculative, signal);
      } finally {
        if (speculativeFetches.get(queryHash) === token) speculativeFetches.delete(queryHash);
      }
    },
  });
}

export function usePriceHistory(assetId: string, range: MarketPriceRange, options: { speculative?: boolean; observeOnly?: boolean } = {}): PriceHistoryState {
  const speculative = options.speculative === true;
  const queryKey = publicQueryKey("price-history", assetId, range);
  const queryHash = hashKey(queryKey);
  const query = useHomeQuery({ ...priceHistoryOptions(assetId, range, options), enabled: !options.observeOnly });
  const { fetchStatus, refetch } = query;
  const liveHash = useRef<string | null>(null);
  useEffect(() => {
    liveHash.current = queryHash;
    return () => { liveHash.current = null; };
  }, [queryHash]);
  useEffect(() => {
    if (options.observeOnly || speculative || fetchStatus !== "fetching" || !speculativeFetches.has(queryHash)) return;
    const client = browserHomeQueryClient();
    if (!client) return;
    speculativeFetches.delete(queryHash);
    void client.cancelQueries({ queryKey: publicQueryKey("price-history", assetId, range), exact: true })
      .then(() => { if (liveHash.current === queryHash) void refetch(); });
  }, [options.observeOnly, speculative, fetchStatus, queryHash, assetId, range, refetch]);
  const cached = query.isPlaceholderData || query.data?.assetId !== assetId || query.data?.range !== range
    ? undefined : query.data;
  const view = queryViewState(query, {
    hasCachedData: cached?.status === "ready" || cached?.status === "empty",
    isEmpty: cached?.status === "empty",
    degraded: query.data !== undefined && !query.isPlaceholderData
      && cached?.status !== "ready" && cached?.status !== "empty",
  });
  if (view === "loading") return { status: "loading", points: [] };
  if (view === "ready" && cached?.status === "ready") return { status: "ready", points: cached.points, source: cached.source, coverage: cached.coverage, asOf: Date.parse(cached.points.at(-1)?.time ?? cached.fetchedAt ?? "") };
  if (view === "failed-with-data" && cached?.status === "ready") {
    const fetchedAt = Date.parse(cached.fetchedAt ?? "");
    return { status: "stale", points: cached.points, source: cached.source, coverage: cached.coverage, asOf: Number.isFinite(fetchedAt) ? fetchedAt : query.dataUpdatedAt };
  }
  if (view === "empty" && cached) return { status: "empty", points: [], source: cached.source, coverage: cached.coverage, asOf: Date.parse(cached.fetchedAt ?? "") };
  return { status: "error", points: [] };
}

