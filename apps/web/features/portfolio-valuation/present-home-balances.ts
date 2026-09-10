import { formatPresentationTokenAmount } from "@/features/formatting";
import type {
  CashBucket,
  DirectPortfolioHolding,
  NativeCashValuation,
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
  assetKey?: string;
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
  revalidating?: true;
  /** Current-snapshot membership hints; never written to the presentation cache. */
  unavailableItemIds?: readonly string[];
};

/** Home hub teaser. The nested Balances panel lists every presented row. */
export const HOME_BALANCES_HUB_PREVIEW_COUNT = 4;

export function previewHomeBalanceItems(
  items: readonly HomeAssetBalanceItem[],
  limit = HOME_BALANCES_HUB_PREVIEW_COUNT,
): readonly HomeAssetBalanceItem[] {
  return items.slice(0, limit);
}

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
      ...snapshot.cashBuckets.map((bucket) =>
        presentCashBucket(bucket, snapshot.nativeCashValuations),
      ),
      ...presentAssetRows(snapshot),
    ],
    ...presentUnavailableAssetRowIds(snapshot),
  };
}

function presentCashBucket(
  bucket: CashBucket,
  nativeCashValuations: readonly NativeCashValuation[] | undefined,
): HomeAssetBalanceItem {
  const name = presentationCurrencyName(bucket.denominationCurrency);
  if (bucket.valuationStatus === "unsupported") {
    return {
      id: bucket.id,
      assetKey: bucket.assetKey ?? bucket.id,
      group: "cash",
      name,
      displayBalance: formatPresentationFiat(
        { atoms: "0", scale: 2 },
        bucket.denominationCurrency,
      ),
      currencyCode: bucket.denominationCurrency,
    };
  }

  const nativeValuation = nativeCashValuations?.find(
    (valuation) =>
      valuation.holdingAssetKey === bucket.assetKey &&
      valuation.denominationCurrency === bucket.denominationCurrency,
  );
  const valuationStatus = nativeValuation?.status ?? bucket.valuationStatus;
  const indicativeValue = nativeValuation
    ? nativeValuation.value
    : bucket.indicativeValue;

  if (valuationStatus === "read-unavailable") {
    return {
      id: bucket.id,
      assetKey: bucket.assetKey ?? bucket.id,
      group: "cash",
      name,
      displayBalance: "Unavailable",
      currencyCode: bucket.denominationCurrency,
      tone: "error",
    };
  }

  if (valuationStatus === "priced" && indicativeValue) {
    return {
      id: bucket.id,
      assetKey: bucket.assetKey ?? bucket.id,
      group: "cash",
      name,
      displayBalance: formatPresentationFiat(
        indicativeValue,
        bucket.denominationCurrency,
      ),
      currencyCode: bucket.denominationCurrency,
    };
  }

  const tokenAmount = unpricedCashTokenAmount(bucket, valuationStatus);
  return {
    id: bucket.id,
    assetKey: bucket.assetKey ?? bucket.id,
    group: "cash",
    name,
    displayBalance: tokenAmount ?? "—",
    currencyCode: bucket.denominationCurrency,
    ...(tokenAmount ? {} : { tone: "muted" as const }),
  };
}

function unpricedCashTokenAmount(
  bucket: CashBucket,
  valuationStatus: CashBucket["valuationStatus"] | NativeCashValuation["status"],
): string | null {
  if (
    valuationStatus !== "unpriced" ||
    bucket.tokenAmountBaseUnits === null ||
    bucket.tokenDecimals === null ||
    !/^(?:0|[1-9]\d*)$/.test(bucket.tokenAmountBaseUnits) ||
    !Number.isSafeInteger(bucket.tokenDecimals) ||
    bucket.tokenDecimals < 0 ||
    bucket.tokenDecimals > 255
  ) {
    return null;
  }

  return formatPresentationTokenAmount(
    bucket.tokenAmountBaseUnits,
    bucket.tokenDecimals,
    bucket.symbol,
    { cashCurrency: bucket.denominationCurrency },
  );
}

function presentAssetRows(
  snapshot: PortfolioValuationSnapshot,
): HomeAssetBalanceItem[] {
  const cashAssetKeys = selectedCashAssetKeys(snapshot);
  const fiat: HomeAssetBalanceItem[] = [];
  const other: HomeAssetBalanceItem[] = [];
  for (const holding of snapshot.inventory.holdings) {
    if (!isPresentedDirectHolding(holding, cashAssetKeys)) continue;
    if (holding.readStatus !== "ready" || holding.balanceBaseUnits === null) {
      continue;
    }
    const balanceBaseUnits = holding.balanceBaseUnits;
    if (balanceBaseUnits === "0") continue;

    const item = presentDirectAssetRow(snapshot, { ...holding, balanceBaseUnits });
    if (item.currencyCode) fiat.push(item);
    else other.push(item);
  }
  return [...fiat, ...other];
}

function presentDirectAssetRow(
  snapshot: PortfolioValuationSnapshot,
  holding: DirectPortfolioHolding & { balanceBaseUnits: string },
): HomeAssetBalanceItem {
  const nativeLabel = formatPresentationTokenAmount(
    holding.balanceBaseUnits,
    holding.decimals,
    holding.symbol,
    {
      cashCurrency: holding.cashCurrency,
      category: holding.assetKind === "native" ? "crypto" : undefined,
    },
  );
  const nativeCashValuation = snapshot.nativeCashValuations?.find(
    (valuation) => valuation.holdingAssetKey === holding.assetKey,
  );
  if (holding.cashCurrency) {
    const nativeCashFiat =
      nativeCashValuation?.status === "priced" && nativeCashValuation.value
        ? formatPresentationFiat(
            nativeCashValuation.value,
            nativeCashValuation.denominationCurrency,
          )
        : null;
    return {
      id: `asset:${holding.assetKey}`,
      assetKey: holding.assetKey,
      group: "asset",
      name: holding.name,
      detail: holding.symbol,
      displayBalance: nativeCashFiat ?? nativeLabel,
      currencyCode: holding.cashCurrency,
    };
  }

  const pricedFiat = pricedDisplayFiat(
    snapshot.lines.find((line) => line.holdingAssetKey === holding.assetKey),
    holding,
  );

  return {
    id: `asset:${holding.assetKey}`,
    assetKey: holding.assetKey,
    group: "asset",
    name: holding.name,
    detail: holding.symbol,
    displayBalance: pricedFiat ?? nativeLabel,
    ...(pricedFiat ? { displayContext: nativeLabel } : {}),
    currencyCode: holding.cashCurrency,
  };
}

function presentUnavailableAssetRowIds(
  snapshot: PortfolioValuationSnapshot,
): Pick<HomeAssetBalancesPresentation, "unavailableItemIds"> {
  const cashAssetKeys = selectedCashAssetKeys(snapshot);
  const unavailableItemIds = snapshot.inventory.holdings.flatMap((holding) => {
    if (!isPresentedDirectHolding(holding, cashAssetKeys)) return [];
    if (holding.readStatus === "ready" && holding.balanceBaseUnits !== null) {
      return [];
    }
    return [`asset:${holding.assetKey}`];
  });
  return unavailableItemIds.length > 0 ? { unavailableItemIds } : {};
}

function isPresentedDirectHolding(
  holding: PortfolioValuationSnapshot["inventory"]["holdings"][number],
  cashAssetKeys: Set<string>,
): holding is DirectPortfolioHolding {
  return holding.kind === "direct" && !cashAssetKeys.has(holding.assetKey);
}

function selectedCashAssetKeys(snapshot: PortfolioValuationSnapshot): Set<string> {
  return new Set(
    snapshot.cashBuckets.flatMap((bucket) =>
      bucket.assetKey ? [bucket.assetKey] : [],
    ),
  );
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
