import type { FiatCurrencyCode } from "@/config/regions";
import {
  addFractions,
  exactDecimalToFraction,
  roundFractionPreservingPositive,
  type Fraction,
} from "./math";
import type { BalancesBorrow, BalancesTotal, BalancesTotals, Holding, HoldingValue } from "./types";

type Contribution = { balance: { baseUnits: string }; value: HoldingValue };
type Sum = { fraction: Fraction; partial: boolean };

export function hasUnavailableFx(contribution: Contribution): boolean {
  return BigInt(contribution.balance.baseUnits) > BigInt(0) &&
    contribution.value.status === "unpriced" && contribution.value.reason === "fx-unavailable";
}

export function computeGrossTotal({ quoteCurrency, holdings }: {
  quoteCurrency: FiatCurrencyCode | null;
  holdings: readonly Holding[];
}): BalancesTotal {
  if (quoteCurrency === null) return { status: "no-quote-currency", value: null, currency: null };
  const gross = sumPriced(holdings);
  return {
    status: gross.partial ? "partial" : "complete",
    value: roundFractionPreservingPositive(gross.fraction),
    currency: quoteCurrency,
  };
}

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
  const assets = addFractions([cash.fraction, investments.fraction]);
  const assetsScaled = assets.numerator * debt.fraction.denominator;
  const debtScaled = debt.fraction.numerator * assets.denominator;
  const negative = debtScaled > assetsScaled;
  const magnitude: Fraction = {
    numerator: negative ? debtScaled - assetsScaled : assetsScaled - debtScaled,
    denominator: assets.denominator * debt.fraction.denominator,
  };
  const total = (value: Fraction, partial: boolean): BalancesTotal => ({
    status: partial ? "partial" : "complete",
    value: roundFractionPreservingPositive(value),
    currency: quoteCurrency,
  });
  return {
    cash: total(cash.fraction, cash.partial),
    investments: total(investments.fraction, investments.partial),
    borrow: total(debt.fraction, debt.partial),
    net: { ...total(magnitude, cash.partial || investments.partial || debt.partial), negative },
  };
}

function isCashComponent(holding: Holding): boolean {
  return holding.cashCurrency !== null || holding.kind === "vault-share";
}

function sumPriced(entries: readonly Contribution[]): Sum {
  return {
    fraction: addFractions(entries.flatMap((entry) =>
      entry.value.status === "priced" ? [exactDecimalToFraction(entry.value.amount)] : [],
    )),
    partial: entries.some(hasUnavailableFx),
  };
}
