// Route contract.
// GET /api/market-prices

import { presentationRegions, type FiatCurrencyCode } from "@/config/regions";
import { investAssets } from "@/config/invest-assets";
import { type MarketSnapshot } from "@/shared/invest/invest-market";
import type {
  MarketDataState,
  PresentationFxQuote,
} from "@/shared/invest/invest-market";

export const MARKET_PRICES_VERSION = 1 as const;

export type MarketPricesFxQuote = Omit<PresentationFxQuote, "quoteCurrency"> & {
  quoteCurrency: FiatCurrencyCode;
};
/** Valuation / executable-adjacent Codex quotes. */
export const MARKET_PRICE_FRESHNESS_MS = 5 * 60_000;
/**
 * Invest discover indications. Codex `timestamp` is last trade, not fetch time;
 * thinner Base markets (cbDOGE, cbLTC, TOSHI) routinely age past five minutes
 * while still having coverage. Wrong-identity and missing rows stay omitted.
 */
export const MARKET_PRICE_DISPLAY_FRESHNESS_MS = 24 * 60 * 60 * 1_000;

export type MarketPricesResponse = {
  version: typeof MARKET_PRICES_VERSION;
  provider: "codex";
  fetchedAt: string | null;
  unavailableReason?: "not-configured";
  markets: Readonly<Record<string, MarketDataState>>;
  /** Coinbase USD FX for local presentation. Omitted when the FX read fails. */
  fx?: readonly MarketPricesFxQuote[];
};

const presentationFiatCodes = new Set<FiatCurrencyCode>(
  Object.values(presentationRegions).flatMap((region) =>
    region.currency.code ? [region.currency.code] : [],
  ),
);
const marketPriceAssetIds = new Set<string>(investAssets.map((asset) => asset.id));

function isFiatCurrencyCode(value: string): value is FiatCurrencyCode {
  return presentationFiatCodes.has(value as FiatCurrencyCode);
}

export function parseMarketPricesResponse(value: unknown): MarketPricesResponse | null {
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
      !marketPriceAssetIds.has(snapshot.assetId) ||
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

