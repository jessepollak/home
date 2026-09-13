"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
import {
  MARKET_PRICE_HISTORY_VERSION,
  MARKET_PRICE_RANGES,
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/history-contract";

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
        {
          headers: { ...deploymentHeaders(), accept: "application/json" },
          cache: "no-store",
          signal,
        },
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

function parseHistoryResponse(value: unknown): MarketPriceHistoryResponse | null {
  const record = readRecord(value);
  if (!record || record.version !== MARKET_PRICE_HISTORY_VERSION || record.provider !== "codex" ||
    typeof record.assetId !== "string" || typeof record.range !== "string" ||
    !(MARKET_PRICE_RANGES as readonly string[]).includes(record.range) ||
    (record.currency !== undefined && record.currency !== "USD") ||
    !(record.status === "ready" || record.status === "empty" || record.status === "unavailable" || record.status === "error") ||
    !Array.isArray(record.points)) return null;
  const points: MarketPriceHistoryPoint[] = [];
  for (const item of record.points) {
    const point = readRecord(item);
    if (!point || typeof point.time !== "string" || !Number.isFinite(Date.parse(point.time)) ||
      typeof point.value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(point.value) ||
      !/[1-9]/.test((point.value.split(/[eE]/)[0] ?? ""))) return null;
    points.push({ time: point.time, value: point.value });
  }
  return {
    version: MARKET_PRICE_HISTORY_VERSION,
    provider: "codex",
    assetId: record.assetId as MarketPriceHistoryResponse["assetId"],
    range: record.range as MarketPriceRange,
    currency: "USD",
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : null,
    status: record.status,
    points,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
