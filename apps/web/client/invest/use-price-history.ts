"use client";

import { useEffect, useState } from "react";
import {
  MARKET_PRICE_HISTORY_VERSION,
  MARKET_PRICE_RANGES,
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/server/market-data/codex/history-contract";

const HISTORY_ENDPOINT = "/api/market-prices/history";

export type PriceHistoryState =
  | { status: "loading"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "ready"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "empty"; points: readonly MarketPriceHistoryPoint[] }
  | { status: "error"; points: readonly MarketPriceHistoryPoint[] };

export function usePriceHistory(
  assetId: string,
  range: MarketPriceRange,
): PriceHistoryState {
  const requestKey = `${assetId}:${range}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    state: PriceHistoryState;
  }>({
    key: requestKey,
    state: { status: "loading", points: [] },
  });

  useEffect(() => {
    const controller = new AbortController();

    void fetch(
      `${HISTORY_ENDPOINT}?assetId=${encodeURIComponent(assetId)}&range=${encodeURIComponent(range)}`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = parseHistoryResponse(await response.json());
        if (!payload || payload.assetId !== assetId || payload.range !== range) {
          throw new Error("Invalid history response");
        }
        if (payload.status === "ready" && payload.points.length > 0) {
          setLoaded({
            key: requestKey,
            state: { status: "ready", points: payload.points },
          });
          return;
        }
        if (payload.status === "empty" || payload.status === "ready") {
          setLoaded({
            key: requestKey,
            state: { status: "empty", points: [] },
          });
          return;
        }
        setLoaded({
          key: requestKey,
          state: { status: "error", points: [] },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoaded({
            key: requestKey,
            state: { status: "error", points: [] },
          });
        }
      });

    return () => controller.abort();
  }, [assetId, range, requestKey]);

  if (loaded.key === requestKey) {
    return loaded.state;
  }

  const sameAsset = loaded.key.startsWith(`${assetId}:`);
  return {
    status: "loading",
    points:
      sameAsset && loaded.state.status === "ready" && loaded.state.points.length > 0
        ? loaded.state.points
        : [],
  };
}

function parseHistoryResponse(value: unknown): MarketPriceHistoryResponse | null {
  const record = readRecord(value);
  if (
    !record ||
    record.version !== MARKET_PRICE_HISTORY_VERSION ||
    record.provider !== "codex" ||
    typeof record.assetId !== "string" ||
    typeof record.range !== "string" ||
    !(MARKET_PRICE_RANGES as readonly string[]).includes(record.range) ||
    (record.currency !== undefined && record.currency !== "USD") ||
    !(
      record.status === "ready" ||
      record.status === "empty" ||
      record.status === "unavailable" ||
      record.status === "error"
    ) ||
    !Array.isArray(record.points)
  ) {
    return null;
  }

  const points: MarketPriceHistoryPoint[] = [];
  for (const item of record.points) {
    const point = readRecord(item);
    if (
      !point ||
      typeof point.time !== "string" ||
      !Number.isFinite(Date.parse(point.time)) ||
      typeof point.value !== "string" ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(point.value) ||
      !/[1-9]/.test((point.value.split(/[eE]/)[0] ?? ""))
    ) {
      return null;
    }
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
