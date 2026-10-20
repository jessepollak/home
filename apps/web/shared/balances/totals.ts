import type { FiatCurrencyCode } from "@/config/regions";
import {
  addFractions,
  exactDecimalToFraction,
  roundFractionPreservingPositive,
  type Fraction,
} from "./math";
import type { BalancesBorrow, BalancesTotal, BalancesTotals, Holding, HoldingValue } from "./types";

type Contribution = { value: HoldingValue };

export function computeBalancesTotals({
  quoteCurrency,
  holdings,
  borrow,
}: {
  quoteCurrency: FiatCurrencyCode | null;
  holdings: readonly Holding[];
  borrow: BalancesBorrow;
}): BalancesTotals {
  if (quoteCurrency === null) {
    const none: BalancesTotal = { status: "no-quote-currency", value: null, currency: null };
    return { cash: none, investments: none, borrow: none, net: { ...none, negative: false } };
  }
  const cash = sumPriced(holdings.filter(isCashComponent));
  const investments = sumPriced([
    ...holdings.filter((holding) => !isCashComponent(holding)),
    ...borrow.positions.map((position) => position.collateral),
  ]);
  const debt = sumPriced(borrow.positions.map((position) => position.debt));
  const assets = addFractions([cash, investments]);
  const assetsScaled = assets.numerator * debt.denominator;
  const debtScaled = debt.numerator * assets.denominator;
  const negative = debtScaled > assetsScaled;
  const magnitude: Fraction = {
    numerator: negative ? debtScaled - assetsScaled : assetsScaled - debtScaled,
    denominator: assets.denominator * debt.denominator,
  };
  const total = (value: Fraction): BalancesTotal => ({
    status: "complete",
    value: roundFractionPreservingPositive(value),
    currency: quoteCurrency,
  });
  return {
    cash: total(cash),
    investments: total(investments),
    borrow: total(debt),
    net: { ...total(magnitude), negative },
  };
}

function isCashComponent(holding: Holding): boolean {
  return holding.cashCurrency !== null || holding.kind === "vault-share";
}

function sumPriced(entries: readonly Contribution[]): Fraction {
  return addFractions(entries.flatMap((entry) =>
    entry.value.status === "priced" ? [exactDecimalToFraction(entry.value.amount)] : [],
  ));
}
