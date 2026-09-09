import type { FiatCurrencyCode } from "@/config/regions";
import {
  formatPresentationPrice,
  formatSignedPercentChange,
  scaleDecimalByExact,
} from "@/features/formatting";

export type MarketSnapshot = {
  assetId: string;
  displayPrice: string;
  asOf: string;
  sourceLabel: string;
  sourceUrl?: string;
  changeLabel?: string;
};

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
  tone: "muted" | "error" | "ready";
};

export type MarketPresentationQuote = {
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

    const formattedPrice = formatSnapshotDisplayPrice(snapshot.displayPrice, quote);

    return {
      value: formattedPrice ?? snapshot.displayPrice,
      detail: `${snapshot.sourceLabel} · ${snapshot.asOf}`,
      sourceUrl: snapshot.sourceUrl,
      changeLabel: snapshot.changeLabel
        ? formatSignedPercentChange(snapshot.changeLabel) ?? snapshot.changeLabel
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
    return formatPresentationPrice(usdAmount, "USD");
  }

  if (!quote.quoteUnitsPerUsd) return "—";
  const localAmount = scaleDecimalByExact(usdAmount, quote.quoteUnitsPerUsd);
  if (!localAmount) return "—";
  return formatPresentationPrice(localAmount, currency) ?? "—";
}
