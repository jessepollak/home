import type { CashBucket } from "@/server/valuation/types";
import {
  formatPresentationFiat,
  presentationCurrencyName,
} from "./format";
import type { PortfolioValuationState } from "./types";

export type HomeAssetBalanceItem = {
  id: string;
  group?: "cash" | "asset";
  name: string;
  detail?: string;
  displayBalance: string;
  displayContext?: string;
  currencyCode?: string | null;
  tone?: "default" | "muted" | "error";
};

export type HomeAssetBalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  statusLabel?: string;
  items: readonly HomeAssetBalanceItem[];
};

export function presentPortfolioValuation(
  valuation: PortfolioValuationState,
): HomeAssetBalancesPresentation {
  if (valuation.status === "loading") {
    return {
      status: "loading",
      displayTotal: null,
      statusLabel: "Updating…",
      items: [],
    };
  }
  if (valuation.status !== "ready") {
    return {
      status: "unavailable",
      displayTotal: null,
      items: [],
    };
  }

  const { snapshot } = valuation;
  const needsQuoteCurrency =
    snapshot.total.status === "unavailable-no-quote-currency";
  const totalUnavailable = snapshot.total.status === "unavailable";

  return {
    status: "ready",
    displayTotal:
      snapshot.total.value && snapshot.total.currency
        ? formatPresentationFiat(snapshot.total.value, snapshot.total.currency)
        : "—",
    statusLabel: needsQuoteCurrency
      ? "Choose a country in Account to set how money is shown"
      : totalUnavailable
        ? "Balance unavailable"
        : undefined,
    items: snapshot.cashBuckets.map(presentCashBucket),
  };
}

function presentCashBucket(bucket: CashBucket): HomeAssetBalanceItem {
  const name = presentationCurrencyName(bucket.denominationCurrency);
  if (bucket.valuationStatus === "unsupported") {
    return {
      id: bucket.id,
      group: "cash",
      name,
      displayBalance: formatPresentationFiat(
        { atoms: "0", scale: 2 },
        bucket.denominationCurrency,
      ),
      currencyCode: bucket.denominationCurrency,
    };
  }

  if (bucket.indicativeValue) {
    return {
      id: bucket.id,
      group: "cash",
      name,
      displayBalance: formatPresentationFiat(
        bucket.indicativeValue,
        bucket.denominationCurrency,
      ),
      currencyCode: bucket.denominationCurrency,
    };
  }

  const readFailed = bucket.valuationStatus === "read-unavailable";
  return {
    id: bucket.id,
    group: "cash",
    name,
    displayBalance: readFailed ? "Unavailable" : "—",
    currencyCode: bucket.denominationCurrency,
    tone: readFailed ? "error" : "muted",
  };
}
