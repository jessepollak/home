import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import {
  formatPresentationPrice,
  formatSignedPercentChange,
  scaleDecimalByExact,
} from "@/shared/formatting";

export type MarketSnapshot = {
  assetId: string;
  displayPrice: string;
  asOf: string;
  sourceLabel: string;
  sourceUrl?: string;
  changeLabel?: string;
  session?: MarketSession;
  checkedAt?: string;
};

export const MARKET_SESSION_RECHECK_MS = 5 * 60_000;

export type MarketSession = "open" | "closed" | "paused" | "stale";

export type MarketDataState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; message?: string }
  | { status: "ready"; snapshots: readonly MarketSnapshot[] };

export type MarketDisplay = {
  value: string;
  detail: string;
  sourceUrl?: string;
  changeLabel?: string;
  context?: "Last close" | "Paused" | "Price delayed";
  tone: "muted" | "error" | "ready";
};

export type MarketPresentationQuote = {
  regionId?: RegionId;
  valueCurrency?: string | null;
  quoteUnitsPerUsd?: { atoms: string; scale: number } | null;
};

export type PresentationFxQuote = {
  quoteCurrency: FiatCurrencyCode;
  quoteUnitsPerUsd: { atoms: string; scale: number } | null;
  status: "fresh" | "unavailable";
};

export const unavailableMarketData = {
  status: "unavailable",
} as const satisfies MarketDataState;

export function getMarketDisplay(
  assetId: string,
  market: MarketDataState,
  quote: MarketPresentationQuote = {},
): MarketDisplay {
  if (market.status === "loading") {
    return {
      value: "—",
      detail: "Loading price",
      tone: "muted",
    };
  }

  if (market.status === "error") {
    return {
      value: "—",
      detail: market.message ?? "Pricing unavailable",
      tone: "error",
    };
  }

  if (market.status === "ready") {
    const snapshot = market.snapshots.find((item) => item.assetId === assetId);
    if (!snapshot) {
      return {
        value: "—",
        detail: "No price supplied",
        tone: "muted",
      };
    }

    if (snapshot.session === "paused" || snapshot.session === "stale") {
      const context = snapshot.session === "paused" ? "Paused" : "Price delayed";
      return {
        value: "—",
        detail: context,
        context,
        sourceUrl: snapshot.sourceUrl,
        tone: "muted",
      };
    }

    const formattedPrice = formatSnapshotDisplayPrice(snapshot.displayPrice, quote);

    return {
      value: formattedPrice ?? snapshot.displayPrice,
      detail: `${snapshot.sourceLabel} · ${snapshot.asOf}`,
      ...(snapshot.session === "closed" ? { context: "Last close" as const } : {}),
      sourceUrl: snapshot.sourceUrl,
      changeLabel: snapshot.changeLabel
        ? formatSignedPercentChange(snapshot.changeLabel, quote.regionId) ?? snapshot.changeLabel
        : undefined,
      tone: "ready",
    };
  }

  return {
    value: "—",
    detail: "Price unavailable",
    tone: "muted",
  };
}

function formatSnapshotDisplayPrice(
  displayPrice: string,
  quote: MarketPresentationQuote,
): string | null {
  if (!displayPrice.startsWith("$")) return null;

  const usdAmount = displayPrice.slice(1);
  const currency = quote.valueCurrency && quote.valueCurrency !== "USD"
    ? quote.valueCurrency
    : "USD";

  if (currency === "USD") {
    return formatPresentationPrice(usdAmount, "USD", quote.regionId);
  }

  if (!quote.quoteUnitsPerUsd) return "—";
  const localAmount = scaleDecimalByExact(usdAmount, quote.quoteUnitsPerUsd);
  if (!localAmount) return "—";
  return formatPresentationPrice(localAmount, currency, quote.regionId) ?? "—";
}
