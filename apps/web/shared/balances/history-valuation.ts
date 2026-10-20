import type { FiatCurrencyCode } from "@/config/regions";
import {
  baseUnitsToFraction,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
} from "./math";
import {
  computeHistoryTotals,
  type HistoryBorrow,
  type HistoryHolding,
  type HistoryHoldingBalance,
  type HistoryHoldingValue,
  type HistoryNetTotal,
  type HistoryTotal,
  type HistoryTotals,
} from "./history-totals";
import type { AssetKey, BorrowMarketKey, Erc20AssetKey, ExactDecimal } from "./types";

type Quantity =
  | { status: "ready"; baseUnits: bigint }
  | { status: "unavailable"; reason: "pending-read" | "mismatch" | "unsupported" };

type PriceBasis =
  | { status: "close"; usdPerToken: ExactDecimal }
  | { status: "missing"; reason: "no-recent-close" | "unpriced-basis" };

type SeriesValue = { atoms: bigint; scale: number };

type AssetMeta = {
  key: AssetKey;
  decimals: number;
  symbol: string;
  name: string;
  cashCurrency: FiatCurrencyCode | null;
};

type AssetInput = AssetMeta & {
  admission: "admitted" | "below-market-gate";
  quantity: Quantity;
} & (
  | { kind: "native" | "erc20"; price: PriceBasis }
  | { kind: "vault-share"; rate: SeriesValue | null; underlyingDecimals: number; underlyingPrice: PriceBasis }
);

type MorphoToken = {
  assetKey: string;
  asset: AssetMeta & { key: Erc20AssetKey };
  price: PriceBasis;
};

type MorphoPosition = {
  marketId: BorrowMarketKey;
  collateral: MorphoToken & { quantity: Quantity };
  loan: MorphoToken & { borrowShares: Quantity; borrowIndex: SeriesValue | null };
};

type HistoryPointInput = {
  inventory: "complete" | "incomplete";
  quoteCurrency: FiatCurrencyCode | null;
  assets: readonly AssetInput[];
  morphoPositions: readonly MorphoPosition[];
  unpriced?: readonly { assetKey: string; reason: MissingReason; component?: "investments" | "borrow" | "cash" }[];
  fx: { status: "ready"; quotePerUsd: ExactDecimal } | { status: "missing" };
};

type MissingReason =
  | "pending-read"
  | "mismatch"
  | "unsupported"
  | "no-recent-close"
  | "unpriced-basis"
  | "fx-unavailable"
  | "below-market-gate";

type HistoryPointValue = HistoryTotals & {
  coverage: "complete" | "partial" | "unavailable";
  missing: { assetKey: string; reason: MissingReason }[];
};

type Pricing = Pick<HistoryPointInput, "quoteCurrency" | "fx">;

function valueAmount(baseUnits: bigint, decimals: number, price: ExactDecimal, pricing: Pricing): ExactDecimal {
  const factors = [baseUnitsToFraction(baseUnits.toString(), decimals), exactDecimalToFraction(price)];
  if (pricing.quoteCurrency !== "USD" && pricing.fx.status === "ready") {
    factors.push(exactDecimalToFraction(pricing.fx.quotePerUsd));
  }
  return roundFractionPreservingPositive(multiplyFractions(...factors));
}

function pricedValue(
  baseUnits: bigint,
  decimals: number,
  price: PriceBasis,
  pricing: Pricing,
  assetKey: string,
  missing: HistoryPointValue["missing"],
  admission: AssetInput["admission"] = "admitted",
): HistoryHoldingValue {
  if (baseUnits === BigInt(0)) {
    return { status: "priced", currency: pricing.quoteCurrency ?? "USD", amount: { atoms: "0", scale: 0 }, asOf: "" };
  }
  if (admission === "below-market-gate") {
    missing.push({ assetKey, reason: "below-market-gate" });
    return { status: "unpriced", reason: "below-market-gate" };
  }
  if (price.status === "missing") {
    missing.push({ assetKey, reason: price.reason });
    return { status: "unpriced", reason: "price-unavailable" };
  }
  if (pricing.quoteCurrency === null) return { status: "unpriced", reason: "no-quote-currency" };
  if (pricing.quoteCurrency !== "USD" && pricing.fx.status === "missing") {
    missing.push({ assetKey, reason: "fx-unavailable" });
    return { status: "unpriced", reason: "fx-unavailable" };
  }
  return {
    status: "priced",
    currency: pricing.quoteCurrency,
    amount: valueAmount(baseUnits, decimals, price.usdPerToken, pricing),
    asOf: "",
  };
}

function baseUnitsFromSeries(baseUnits: bigint, series: SeriesValue, rounding: "floor" | "ceil"): bigint {
  if (series.atoms < BigInt(0) || !Number.isSafeInteger(series.scale) || series.scale < 0 || series.scale > 1_000) {
    throw new TypeError("Invalid history series value.");
  }
  const divisor = BigInt(10) ** BigInt(series.scale);
  const product = baseUnits * series.atoms;
  return rounding === "ceil" ? (product + divisor - BigInt(1)) / divisor : product / divisor;
}

function holdingBalance(quantity: Quantity): HistoryHoldingBalance {
  return quantity.status === "ready"
    ? { status: "ready", baseUnits: quantity.baseUnits.toString() }
    : { status: "unavailable", baseUnits: null };
}

function incomplete(total: HistoryTotal): HistoryTotal {
  if (total.status !== "complete") return total;
  return total.value === null || total.value.atoms === "0"
    ? { ...total, status: "unavailable", value: null }
    : { ...total, status: "partial" };
}

export function valueHistoryPoint(input: HistoryPointInput): HistoryPointValue {
  const missing: HistoryPointValue["missing"] = [];
  const pricing: Pricing = { quoteCurrency: input.quoteCurrency, fx: input.fx };
  const holdings: HistoryHolding[] = input.assets.map((asset): HistoryHolding => {
    const balance = holdingBalance(asset.quantity);
    let value: HistoryHoldingValue;
    if (asset.quantity.status === "unavailable") {
      missing.push({ assetKey: asset.key, reason: asset.quantity.reason });
      value = { status: "unavailable" };
    } else if (asset.kind === "vault-share") {
      if (asset.quantity.baseUnits > BigInt(0) && asset.admission === "below-market-gate") {
        missing.push({ assetKey: asset.key, reason: "below-market-gate" });
        value = { status: "unpriced", reason: "below-market-gate" };
      } else if (asset.quantity.baseUnits > BigInt(0) && asset.rate === null) {
        missing.push({ assetKey: asset.key, reason: "unpriced-basis" });
        value = { status: "unpriced", reason: "price-unavailable" };
      } else {
        const underlying = asset.rate === null ? BigInt(0) : baseUnitsFromSeries(asset.quantity.baseUnits, asset.rate, "floor");
        value = pricedValue(underlying, asset.underlyingDecimals, asset.underlyingPrice, pricing, asset.key, missing);
      }
    } else {
      value = pricedValue(asset.quantity.baseUnits, asset.decimals, asset.price, pricing, asset.key, missing, asset.admission);
    }
    return {
      kind: asset.kind,
      cashCurrency: asset.cashCurrency,
      balance,
      value,
    };
  });

  const borrow: HistoryBorrow = { coverage: "complete", positions: [] };
  for (const position of input.morphoPositions) {
    const { collateral, loan } = position;
    if (collateral.quantity.status === "unavailable" || loan.borrowShares.status === "unavailable" || (loan.borrowShares.status === "ready" && loan.borrowShares.baseUnits > BigInt(0) && loan.borrowIndex === null)) {
      borrow.coverage = "partial";
      if (collateral.quantity.status === "unavailable") missing.push({ assetKey: collateral.assetKey, reason: collateral.quantity.reason });
      if (loan.borrowShares.status === "unavailable") missing.push({ assetKey: loan.assetKey, reason: loan.borrowShares.reason });
      else if (loan.borrowShares.baseUnits > BigInt(0) && loan.borrowIndex === null) missing.push({ assetKey: loan.assetKey, reason: "unpriced-basis" });
      continue;
    }
    const collateralValue = pricedValue(collateral.quantity.baseUnits, collateral.asset.decimals, collateral.price, pricing, collateral.assetKey, missing);
    const debt = loan.borrowIndex === null ? BigInt(0) : baseUnitsFromSeries(loan.borrowShares.baseUnits, loan.borrowIndex, "ceil");
    const debtValue = pricedValue(debt, loan.asset.decimals, loan.price, pricing, loan.assetKey, missing);
    borrow.positions.push({
      collateral: {
        balance: { status: "ready", baseUnits: collateral.quantity.baseUnits.toString() },
        value: collateralValue,
      },
      debt: {
        balance: { status: "ready", baseUnits: debt.toString() },
        value: debtValue,
      },
    });
  }

  const computed = computeHistoryTotals({
    quoteCurrency: input.quoteCurrency,
    holdings,
    coverage: {
      registry: input.assets.some((asset) => asset.admission === "admitted" && asset.quantity.status === "unavailable") ? "partial" : "complete",
      catalog: input.inventory,
    },
    borrow,
  });
  const unpriced = input.unpriced ?? [];
  for (const { assetKey, reason } of unpriced) {
    if (!missing.some((current) => current.assetKey === assetKey)) missing.push({ assetKey, reason });
  }
  const components = new Set(unpriced.map((entry) => entry.component ?? "investments"));
  const totals = {
    cash: components.has("cash") ? incomplete(computed.cash) : computed.cash,
    investments: components.has("investments") ? incomplete(computed.investments) : computed.investments,
    borrow: components.has("borrow") ? incomplete(computed.borrow) : computed.borrow,
    net: unpriced.length ? incomplete(computed.net) as HistoryNetTotal : computed.net,
  };
  return {
    ...totals,
    coverage: totals.net.status === "no-quote-currency" ? "unavailable" : totals.net.status,
    missing,
  };
}

export function withinEthWeightedTolerance(input: {
  history: ExactDecimal;
  reference: ExactDecimal;
  ethWeightedValue: ExactDecimal;
}): boolean {
  const history = exactDecimalToFraction(input.history);
  const reference = exactDecimalToFraction(input.reference);
  const weighted = exactDecimalToFraction(input.ethWeightedValue);
  const delta = history.numerator * reference.denominator - reference.numerator * history.denominator;
  const magnitude = delta < BigInt(0) ? -delta : delta;
  return magnitude * BigInt(200) * weighted.denominator <= weighted.numerator * history.denominator * reference.denominator;
}
