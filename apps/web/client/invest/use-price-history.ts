"use client";

import { hashKey, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { browserHomeQueryClient, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
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
  | { status: "empty"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "error"; points: readonly MarketPriceHistoryPoint[] };

async function fetchHistory(
  assetId: string,
  range: MarketPriceRange,
  speculative: boolean,
  signal: AbortSignal,
): Promise<MarketPriceHistoryResponse> {
  const response = await fetch(
    `${HISTORY_ENDPOINT}?assetId=${encodeURIComponent(assetId)}&range=${encodeURIComponent(range)}`,
    {
      headers: { ...deploymentHeaders(), accept: "application/json",
        ...(speculative ? { [MARKET_HISTORY_PRIORITY_HEADER]: "prefetch" } : {}) },
      cache: "no-store",
      signal,
    },
  );
  const payload = parseHistoryResponse(await response.json());
  if (!response.ok || payload?.unavailableReason === "overloaded") {
    throw new Error("History request failed");
  }
  if (!payload || payload.assetId !== assetId || payload.range !== range) {
    throw new Error("Invalid history response");
  }
  return payload;
}

export function usePriceHistory(assetId: string, range: MarketPriceRange, options: { speculative?: boolean } = {}): PriceHistoryState {
  const speculative = options.speculative === true;
  const queryKey = publicQueryKey("price-history", assetId, range);
  const queryHash = hashKey(queryKey);
  const query = useHomeQuery<MarketPriceHistoryResponse>({
    queryKey,
    staleTime: 60_000,
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
  if (query.isPending) return { status: "loading", points: [] };
  if (query.isError) return { status: "error", points: [] };
  if (query.isPlaceholderData) return { status: "loading", points: query.data.points };
  if (query.data.status === "ready" && query.data.points.length > 0) {
    return { status: "ready", points: query.data.points };
  }
  if (query.data.status === "empty" || query.data.status === "ready") {
    return { status: "empty", points: [] };
  }
  return { status: "error", points: [] };
}

