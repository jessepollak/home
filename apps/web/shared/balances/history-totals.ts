import type { FiatCurrencyCode } from "@/config/regions";
import {
  addFractions,
  exactDecimalToFraction,
  roundFractionPreservingPositive,
  type Fraction,
} from "./math";
import type { ExactDecimal, HoldingValue } from "./types";

export type HistoryHoldingBalance =
  | { status: "ready"; baseUnits: string }
  | { status: "unavailable"; baseUnits: null };
export type HistoryHoldingValue = HoldingValue | { status: "unavailable" };
type Contribution = { balance: HistoryHoldingBalance; value: HistoryHoldingValue };
export type HistoryHolding = Contribution & { cashCurrency: FiatCurrencyCode | null; kind: string };
export type HistoryBorrow = {
  coverage: "complete" | "partial";
  positions: { collateral: Contribution; debt: Contribution }[];
};
export type HistoryTotal = {
  status: "complete" | "partial" | "unavailable" | "no-quote-currency";
  value: ExactDecimal | null;
  currency: FiatCurrencyCode | null;
};
export type HistoryNetTotal = HistoryTotal & { negative: boolean };
export type HistoryTotals = {
  cash: HistoryTotal;
  investments: HistoryTotal;
  borrow: HistoryTotal;
  net: HistoryNetTotal;
};
type Component = { total: HistoryTotal; fraction: Fraction | null };

export function computeHistoryTotals({
  quoteCurrency,
  holdings,
  coverage,
  borrow,
}: {
  quoteCurrency: FiatCurrencyCode | null;
  holdings: readonly HistoryHolding[];
  coverage: { registry: "complete" | "partial"; catalog: "complete" | "incomplete" | "unavailable" };
  borrow: HistoryBorrow;
}): HistoryTotals {
  if (quoteCurrency === null) {
    const none: HistoryTotal = { status: "no-quote-currency", value: null, currency: null };
    return { cash: none, investments: none, borrow: none, net: { ...none, negative: false } };
  }
  const borrowPartial = borrow.coverage !== "complete";
  const cash = component(holdings.filter(isCashComponent), false, quoteCurrency);
  const investments = component(
    [
      ...holdings.filter((holding) => !isCashComponent(holding)),
      ...borrow.positions.map((position) => position.collateral),
    ],
    coverage.catalog !== "complete" || borrowPartial,
    quoteCurrency,
  );
  const debt = component(borrow.positions.map((position) => position.debt), borrowPartial, quoteCurrency);
  return {
    cash: cash.total,
    investments: investments.total,
    borrow: debt.total,
    net: netTotal(cash, investments, debt, quoteCurrency),
  };
}

function isCashComponent(holding: HistoryHolding): boolean {
  return holding.cashCurrency !== null || holding.kind === "vault-share";
}

function component(
  entries: readonly Contribution[],
  knownIncomplete: boolean,
  currency: FiatCurrencyCode,
): Component {
  const knownPositive = entries.filter(
    (entry) => entry.balance.status === "ready" && BigInt(entry.balance.baseUnits) > BigInt(0),
  );
  const incomplete = knownIncomplete ||
    entries.some((entry) => entry.balance.status === "unavailable") ||
    knownPositive.some((entry) => entry.value.status !== "priced");
  const priced = entries.flatMap((entry) =>
    entry.value.status === "priced" ? [exactDecimalToFraction(entry.value.amount)] : [],
  );
  const sum = addFractions(priced);
  if (incomplete && sum.numerator === BigInt(0)) {
    return { total: { status: "unavailable", value: null, currency }, fraction: null };
  }
  return {
    total: {
      status: incomplete ? "partial" : "complete",
      value: roundFractionPreservingPositive(sum),
      currency,
    },
    fraction: sum,
  };
}

function netTotal(
  cash: Component,
  investments: Component,
  debt: Component,
  currency: FiatCurrencyCode,
): HistoryNetTotal {
  const components = [cash, investments, debt];
  const zero: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };
  const assets = addFractions([cash.fraction ?? zero, investments.fraction ?? zero]);
  const owed = debt.fraction ?? zero;
  const assetsScaled = assets.numerator * owed.denominator;
  const owedScaled = owed.numerator * assets.denominator;
  const negative = owedScaled > assetsScaled;
  const magnitude: Fraction = {
    numerator: negative ? owedScaled - assetsScaled : assetsScaled - owedScaled,
    denominator: assets.denominator * owed.denominator,
  };
  const complete = components.every((entry) => entry.total.status === "complete");
  if (!complete && magnitude.numerator === BigInt(0)) {
    return { status: "unavailable", value: null, currency, negative: false };
  }
  return {
    status: complete ? "complete" : "partial",
    value: roundFractionPreservingPositive(magnitude),
    currency,
    negative,
  };
}
