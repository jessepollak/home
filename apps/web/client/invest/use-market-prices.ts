"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { investAssets } from "@/config/invest-assets";
import {
  presentationRegions,
  type FiatCurrencyCode,
} from "@/config/regions";
import {
  MARKET_PRICE_DISPLAY_FRESHNESS_MS,
  MARKET_PRICES_VERSION,
  type MarketPricesResponse,
} from "@/shared/invest/public-contract";
import {
  unavailableMarketData,
  type MarketDataState,
  type MarketSnapshot,
  type PresentationFxQuote,
} from "@/shared/invest/invest-market";

const presentationFiatCodes = new Set<FiatCurrencyCode>(
  Object.values(presentationRegions).flatMap((region) =>
    region.currency.code ? [region.currency.code] : [],
  ),
);

function isFiatCurrencyCode(value: string): value is FiatCurrencyCode {
  return presentationFiatCodes.has(value as FiatCurrencyCode);
}

const MARKET_PRICES_ENDPOINT = "/api/market-prices";
const VISIBILITY_REFRESH_COOLDOWN_MS = 60_000;
const categories = [...new Set(investAssets.map((asset) => asset.category))];
const assetIds = new Set<string>(investAssets.map((asset) => asset.id));

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
  const [marketResponse, setMarketResponse] = useState<MarketPricesResponse>(() =>
    createClientMarketResponse({ status: "loading" }),
  );
  const requestController = useRef<AbortController | null>(null);
  const lastRequestAt = useRef(Number.NEGATIVE_INFINITY);

  const refresh = useCallback(async () => {
    const requestTime = now();
    if (requestTime - lastRequestAt.current < refreshCooldownMs) return;
    lastRequestAt.current = requestTime;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;

    try {
      const response = await fetchImpl(endpoint, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = parseMarketPricesResponse(await response.json());
      if (!payload) throw new Error("Invalid market price response");
      setMarketResponse(ageMarketPricesResponse(payload, now(), freshnessMs));
    } catch {
      if (controller.signal.aborted) return;
      setMarketResponse(
        createClientMarketResponse({
          status: "error",
          message: "Current market prices are unavailable.",
        }),
      );
    }
  }, [endpoint, fetchImpl, freshnessMs, now, refreshCooldownMs]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  useEffect(() => {
    const nextExpiry = findNextExpiry(marketResponse, freshnessMs);
    if (nextExpiry === null) return;

    const delay = Math.max(0, nextExpiry - now() + 1);
    const timeout = window.setTimeout(() => {
      setMarketResponse((current) =>
        ageMarketPricesResponse(current, now(), freshnessMs),
      );
    }, delay);
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

function parseMarketPricesResponse(value: unknown): MarketPricesResponse | null {
  const record = readRecord(value);
  if (
    !record ||
    record.version !== MARKET_PRICES_VERSION ||
    record.provider !== "codex" ||
    !(record.fetchedAt === null || isIsoDate(record.fetchedAt))
  ) {
    return null;
  }

  const marketRecords = readRecord(record.markets);
  if (!marketRecords) return null;
  const markets: Record<string, MarketDataState> = {};

  for (const [category, marketValue] of Object.entries(marketRecords)) {
    const market = parseMarketState(marketValue);
    if (!market) return null;
    markets[category] = market;
  }

  const fx = parseFxQuotes(record.fx);
  if (record.fx !== undefined && fx === null) return null;

  return {
    version: MARKET_PRICES_VERSION,
    provider: "codex",
    fetchedAt: record.fetchedAt as string | null,
    ...(record.unavailableReason === "not-configured"
      ? { unavailableReason: "not-configured" as const }
      : {}),
    markets,
    ...(fx ? { fx } : {}),
  };
}

function parseFxQuotes(value: unknown): PresentationFxQuote[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const quotes: PresentationFxQuote[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (
      !record ||
      typeof record.quoteCurrency !== "string" ||
      !isFiatCurrencyCode(record.quoteCurrency) ||
      (record.status !== "fresh" && record.status !== "unavailable")
    ) {
      return null;
    }
    if (record.status === "unavailable") {
      if (record.quoteUnitsPerUsd !== null && record.quoteUnitsPerUsd !== undefined) {
        return null;
      }
      quotes.push({
        quoteCurrency: record.quoteCurrency,
        quoteUnitsPerUsd: null,
        status: "unavailable",
      });
      continue;
    }
    const factor = readExactScale(record.quoteUnitsPerUsd);
    if (!factor) return null;
    quotes.push({
      quoteCurrency: record.quoteCurrency,
      quoteUnitsPerUsd: factor,
      status: "fresh",
    });
  }
  return quotes;
}

function readExactScale(
  value: unknown,
): { atoms: string; scale: number } | null {
  const record = readRecord(value);
  if (
    !record ||
    typeof record.atoms !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(record.atoms) ||
    typeof record.scale !== "number" ||
    !Number.isSafeInteger(record.scale) ||
    record.scale < 0 ||
    record.scale > 10_000
  ) {
    return null;
  }
  return { atoms: record.atoms, scale: record.scale };
}

function parseMarketState(value: unknown): MarketDataState | null {
  const record = readRecord(value);
  if (!record || typeof record.status !== "string") return null;

  if (record.status === "unavailable" || record.status === "loading") {
    return { status: record.status };
  }
  if (record.status === "error") {
    return typeof record.message === "string"
      ? { status: "error", message: record.message }
      : { status: "error" };
  }
  if (record.status !== "ready" || !Array.isArray(record.snapshots)) return null;

  const snapshots: MarketSnapshot[] = [];
  for (const value of record.snapshots) {
    const snapshot = readRecord(value);
    if (
      !snapshot ||
      typeof snapshot.assetId !== "string" ||
      !assetIds.has(snapshot.assetId) ||
      typeof snapshot.displayPrice !== "string" ||
      snapshot.displayPrice.length === 0 ||
      !isIsoDate(snapshot.asOf) ||
      typeof snapshot.sourceLabel !== "string" ||
      snapshot.sourceLabel.length === 0 ||
      !(
        snapshot.sourceUrl === undefined ||
        typeof snapshot.sourceUrl === "string"
      )
    ) {
      return null;
    }
    snapshots.push({
      assetId: snapshot.assetId,
      displayPrice: snapshot.displayPrice,
      asOf: snapshot.asOf,
      sourceLabel: snapshot.sourceLabel,
      ...(typeof snapshot.sourceUrl === "string"
        ? { sourceUrl: snapshot.sourceUrl }
        : {}),
      ...(typeof snapshot.changeLabel === "string"
        ? { changeLabel: snapshot.changeLabel }
        : {}),
    });
  }

  return { status: "ready", snapshots };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
