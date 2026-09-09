import { formatSignedPercentChange, formatUsdPrice } from "@/features/formatting";

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

export const unavailableMarketData = {
  status: "unavailable",
} as const satisfies MarketDataState;

export function getMarketDisplay(
  assetId: string,
  market: MarketDataState,
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

    const formattedPrice = snapshot.displayPrice.startsWith("$")
      ? formatUsdPrice(snapshot.displayPrice.slice(1))
      : null;

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
