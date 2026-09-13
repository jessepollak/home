"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import {
  parseHistoryResponse,
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/contracts/market-price-history";

const HISTORY_ENDPOINT = "/api/market-prices/history";

export type PriceHistoryState =
  | { status: "loading"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "ready"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "empty"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "error"; points: readonly MarketPriceHistoryPoint[] };

export function usePriceHistory(assetId: string, range: MarketPriceRange): PriceHistoryState {
  const query = useHomeQuery<MarketPriceHistoryResponse>({
    queryKey: publicQueryKey("price-history", assetId, range),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === assetId
        ? keepPreviousData(previous)
        : undefined,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${HISTORY_ENDPOINT}?assetId=${encodeURIComponent(assetId)}&range=${encodeURIComponent(range)}`,
        { headers: { accept: "application/json" }, cache: "no-store", signal },
      );
      const payload = parseHistoryResponse(await response.json());
      if (!payload || payload.assetId !== assetId || payload.range !== range) {
        throw new Error("Invalid history response");
      }
      return payload;
    },
  });
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

