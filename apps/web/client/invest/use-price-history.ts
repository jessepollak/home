"use client";

import { hashKey, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { browserHomeQueryClient, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { publicQuery } from "@/client/query/query-options";
import { publicResource } from "@/client/query/public-resource";
import { queryViewState } from "@/client/query/query-view-state";
import {
  MARKET_HISTORY_PRIORITY_HEADER,
  parseHistoryResponse,
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/contracts/market-price-history";

const HISTORY_ENDPOINT = "/api/market-prices/history";

const speculativeFetches = new Map<string, symbol>();

export type PriceHistoryState =
  | { status: "loading"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "ready"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "stale"; points: readonly MarketPriceHistoryPoint[]; asOf: number }
  | { status: "empty"; points: readonly MarketPriceHistoryPoint[] }
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
  return payload;
}

export function priceHistoryOptions(assetId: string, range: MarketPriceRange, options: { speculative?: boolean } = {}) {
  const speculative = options.speculative === true;
  const queryHash = hashKey(publicQueryKey("price-history", assetId, range));
  return publicQuery<MarketPriceHistoryResponse>({
    scope: "price-history", key: [assetId, range],
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === assetId
        ? keepPreviousData(previous)
        : undefined,
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

export function usePriceHistory(assetId: string, range: MarketPriceRange, options: { speculative?: boolean } = {}): PriceHistoryState {
  const speculative = options.speculative === true;
  const queryKey = publicQueryKey("price-history", assetId, range);
  const queryHash = hashKey(queryKey);
  const query = useHomeQuery(priceHistoryOptions(assetId, range, options));
  const { fetchStatus, refetch } = query;
  const liveHash = useRef<string | null>(null);
  useEffect(() => {
    liveHash.current = queryHash;
    return () => { liveHash.current = null; };
  }, [queryHash]);
  useEffect(() => {
    if (speculative || fetchStatus !== "fetching" || !speculativeFetches.has(queryHash)) return;
    const client = browserHomeQueryClient();
    if (!client) return;
    speculativeFetches.delete(queryHash);
    void client.cancelQueries({ queryKey: publicQueryKey("price-history", assetId, range), exact: true })
      .then(() => { if (liveHash.current === queryHash) void refetch(); });
  }, [speculative, fetchStatus, queryHash, assetId, range, refetch]);
  const cached = query.isPlaceholderData || query.data?.assetId !== assetId || query.data?.range !== range
    ? undefined : query.data;
  const view = queryViewState(query, {
    hasCachedData: cached?.status === "ready" || cached?.status === "empty",
    isEmpty: cached?.status === "empty" || (cached?.status === "ready" && cached.points.length === 0),
    degraded: query.data !== undefined && !query.isPlaceholderData
      && cached?.status !== "ready" && cached?.status !== "empty",
  });
  if (view === "loading") return { status: "loading", points: query.isPlaceholderData ? query.data.points : [] };
  if (view === "ready") return { status: "ready", points: cached?.points ?? [] };
  if (view === "failed-with-data" && cached?.status === "ready") {
    const fetchedAt = Date.parse(cached.fetchedAt ?? "");
    return { status: "stale", points: cached.points, asOf: Number.isFinite(fetchedAt) ? fetchedAt : query.dataUpdatedAt };
  }
  if (view === "empty") return { status: "empty", points: [] };
  return { status: "error", points: [] };
}

