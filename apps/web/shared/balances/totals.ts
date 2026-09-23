import type { FiatCurrencyCode } from "@/config/regions";
import {
  addFractions,
  exactDecimalToFraction,
  roundFractionPreservingPositive,
  type Fraction,
} from "./math";
import type {
  BalancesBorrow,
  BalancesCoverage,
  BalancesNetTotal,
  BalancesTotal,
  BalancesTotals,
  Holding,
  HoldingBalance,
  HoldingValue,
} from "./types";

type Contribution = { balance: HoldingBalance; value: HoldingValue };
type Component = { total: BalancesTotal; fraction: Fraction | null };

export function computeBalancesTotals({
  quoteCurrency,
  holdings,
  coverage,
  borrow,
}: {
  quoteCurrency: FiatCurrencyCode | null;
  holdings: readonly Holding[];
  coverage: BalancesCoverage;
  borrow: BalancesBorrow;
}): BalancesTotals {
  if (quoteCurrency === null) {
    const none: BalancesTotal = { status: "no-quote-currency", value: null, currency: null };
    return { cash: none, investments: none, borrow: none, net: { ...none, negative: false } };
  }
  const borrowPartial = borrow.coverage !== "complete";
  const cash = component(
    holdings.filter(isCashComponent),
    false,
    quoteCurrency,
  );
  const investments = component(
    [
      ...holdings.filter((holding) => !isCashComponent(holding)),
      ...borrow.positions.map((position) => position.collateral),
    ],
    coverage.catalog !== "complete" || borrowPartial,
    quoteCurrency,
  );
  const debt = component(
    borrow.positions.map((position) => position.debt),
    borrowPartial,
    quoteCurrency,
  );
  return {
    cash: cash.total,
    investments: investments.total,
    borrow: debt.total,
    net: netTotal(cash, investments, debt, quoteCurrency),
  };
}

function isCashComponent(holding: Holding): boolean {
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
): BalancesNetTotal {
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
