"use client";

import { useEffect, useMemo, useState } from "react";
import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { investAssets } from "@/config/invest-assets";
import {
  MARKET_PRICE_DISPLAY_FRESHNESS_MS,
  MARKET_PRICES_VERSION,
  parseMarketPricesResponse,
  type MarketPricesResponse,
} from "@/shared/invest/contracts/market-prices";
import {
  unavailableMarketData,
  type MarketDataState,
  type PresentationFxQuote,
} from "@/shared/invest/invest-market";

const MARKET_PRICES_ENDPOINT = "/api/market-prices";
const VISIBILITY_REFRESH_COOLDOWN_MS = 60_000;
const categories = [...new Set(investAssets.map((asset) => asset.category))];

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type PricedInvestMarketProps = {
  stockMarket: MarketDataState;
  memeMarket: MarketDataState;
  cryptoMarket?: MarketDataState;
  fx: readonly PresentationFxQuote[] | null;
};

export type UseMarketPricesOptions = {
  endpoint?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  freshnessMs?: number;
  refreshCooldownMs?: number;
};

export function useMarketPrices({
  endpoint = MARKET_PRICES_ENDPOINT,
  fetchImpl = fetch,
  now = Date.now,
  freshnessMs = MARKET_PRICE_DISPLAY_FRESHNESS_MS,
  refreshCooldownMs = VISIBILITY_REFRESH_COOLDOWN_MS,
}: UseMarketPricesOptions = {}): PricedInvestMarketProps {
  const [, setAgeRevision] = useState(0);
  const marketQuery = useHomeQuery({
    queryKey: publicQueryKey("market-prices", endpoint),
    staleTime: refreshCooldownMs,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetchImpl(endpoint, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const payload = parseMarketPricesResponse(await response.json());
      if (!payload) throw new Error("Invalid market price response");
      return payload;
    },
  });
  const marketResponse = marketQuery.data
    ? ageMarketPricesResponse(marketQuery.data, now(), freshnessMs)
    : createClientMarketResponse({
        status: marketQuery.isError ? "error" : "loading",
        ...(marketQuery.isError ? { message: "Current market prices are unavailable." } : {}),
      });

  useEffect(() => {
    const nextExpiry = findNextExpiry(marketResponse, freshnessMs);
    if (nextExpiry === null) return;
    const delay = Math.max(0, nextExpiry - now() + 1);
    const timeout = window.setTimeout(() => setAgeRevision((value) => value + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [freshnessMs, marketResponse, now]);

  return useMemo(() => {
    const marketProps: PricedInvestMarketProps = {
      stockMarket: marketResponse.markets.stock ?? unavailableMarketData,
      memeMarket: marketResponse.markets.meme ?? unavailableMarketData,
      fx: marketResponse.fx ?? null,
    };
    if (categories.includes("crypto" as (typeof categories)[number])) {
      marketProps.cryptoMarket =
        marketResponse.markets.crypto ?? unavailableMarketData;
    }
    return marketProps;
  }, [marketResponse]);
}

export function ageMarketPricesResponse(
  response: MarketPricesResponse,
  currentTimeMs: number,
  freshnessMs = MARKET_PRICE_DISPLAY_FRESHNESS_MS,
): MarketPricesResponse {
  let changed = false;
  const markets: Record<string, MarketDataState> = {};

  for (const [category, market] of Object.entries(response.markets)) {
    if (market.status !== "ready") {
      markets[category] = market;
      continue;
    }

    const freshSnapshots = market.snapshots.filter((snapshot) => {
      const sourceTime = Date.parse(snapshot.asOf);
      return (
        Number.isFinite(sourceTime) &&
        sourceTime <= currentTimeMs + 60_000 &&
        currentTimeMs - sourceTime <= freshnessMs
      );
    });

    if (freshSnapshots.length === market.snapshots.length) {
      markets[category] = market;
      continue;
    }

    changed = true;
    markets[category] =
      freshSnapshots.length > 0
        ? { status: "ready", snapshots: freshSnapshots }
        : { status: "error", message: "Price snapshot is stale." };
  }

  return changed ? { ...response, markets } : response;
}

function findNextExpiry(
  response: MarketPricesResponse,
  freshnessMs: number,
): number | null {
  let nextExpiry: number | null = null;
  for (const market of Object.values(response.markets)) {
    if (market.status !== "ready") continue;
    for (const snapshot of market.snapshots) {
      const sourceTime = Date.parse(snapshot.asOf);
      if (!Number.isFinite(sourceTime)) continue;
      const expiry = sourceTime + freshnessMs;
      if (nextExpiry === null || expiry < nextExpiry) nextExpiry = expiry;
    }
  }
  return nextExpiry;
}

function createClientMarketResponse(
  state: MarketDataState,
): MarketPricesResponse {
  return {
    version: MARKET_PRICES_VERSION,
    provider: "codex",
    fetchedAt: null,
    markets: Object.fromEntries(categories.map((category) => [category, state])),
  };
}

