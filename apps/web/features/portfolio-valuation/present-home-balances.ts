import { formatPresentationTokenAmount } from "@/features/formatting";
import type {
  CashBucket,
  DirectPortfolioHolding,
  PortfolioValuationSnapshot,
  ValuationLine,
} from "@/server/valuation/types";
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
    items: [
      ...snapshot.cashBuckets.map(presentCashBucket),
      ...presentAssetRows(snapshot),
    ],
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

function presentAssetRows(
  snapshot: PortfolioValuationSnapshot,
): HomeAssetBalanceItem[] {
  const cashAssetKeys = new Set<string>(
    snapshot.cashBuckets.flatMap((bucket) =>
      bucket.assetKey ? [bucket.assetKey] : [],
    ),
  );

  const items: HomeAssetBalanceItem[] = [];
  for (const holding of snapshot.inventory.holdings) {
    if (holding.kind !== "direct") continue;
    const isNative = holding.assetKind === "native";
    const isNonselectedLocalCash =
      holding.cashCurrency !== null && !cashAssetKeys.has(holding.assetKey);
    if (!isNative && !isNonselectedLocalCash) continue;
    if (holding.readStatus !== "ready" || holding.balanceBaseUnits === null) {
      continue;
    }
    if (holding.balanceBaseUnits === "0") continue;

    const nativeLabel = formatPresentationTokenAmount(
      holding.balanceBaseUnits,
      holding.decimals,
      holding.symbol,
      {
        cashCurrency: holding.cashCurrency,
        category: holding.assetKind === "native" ? "crypto" : undefined,
      },
    );
    const pricedFiat = pricedDisplayFiat(
      snapshot.lines.find(
        (line) => line.holdingAssetKey === holding.assetKey,
      ),
      holding,
    );

    items.push({
      id: `asset:${holding.assetKey}`,
      group: "asset",
      name: holding.name,
      detail: holding.symbol,
      displayBalance: pricedFiat ?? nativeLabel,
      ...(pricedFiat ? { displayContext: nativeLabel } : {}),
      currencyCode: holding.cashCurrency,
    });
  }
  return items;
}

function pricedDisplayFiat(
  line: ValuationLine | undefined,
  holding: DirectPortfolioHolding,
): string | null {
  if (line?.status !== "priced" || !line.value) return null;
  if (line.value.atoms === "0" && holding.balanceBaseUnits !== "0") {
    return null;
  }
  return formatPresentationFiat(line.value, line.valueCurrency);
}
