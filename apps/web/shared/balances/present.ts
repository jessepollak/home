import type { FiatCurrencyCode } from "@/config/regions";
import { formatPresentationTokenAmount } from "@/shared/formatting";
import {
  formatPresentationFiat,
  presentationCurrencyName,
} from "@/shared/portfolio/valuation-format";
import { exactDecimalToFraction } from "@/shared/portfolio/valuation-math";
import { selectCash, selectTotal, type CashSelection } from "./select";
import type { BalancesSnapshot, BalancesState, ExactDecimal, Holding } from "./types";

export type BalanceRowModel = {
  key: string;
  group: "cash" | "asset";
  name: string;
  mark:
    | { kind: "flag"; currency: FiatCurrencyCode }
    | { kind: "image"; url: string; fallbackSymbol: string }
    | { kind: "eth" }
    | { kind: "symbol"; symbol: string };
  primary: string;
  secondary: string | null;
  tone: "default" | "muted" | "error";
};

export type BalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  totalStatus?: "complete" | "partial" | "unavailable";
  statusLabel?: string;
  rows: BalanceRowModel[];
  revalidating?: true;
};

export const HOME_BALANCES_HUB_PREVIEW_COUNT = 4;

export function previewBalanceRows(
  rows: readonly BalanceRowModel[],
  limit = HOME_BALANCES_HUB_PREVIEW_COUNT,
): readonly BalanceRowModel[] {
  return rows.slice(0, limit);
}

export function presentBalances(state: BalancesState): BalancesPresentation {
  if (state.status === "loading") {
    return { status: "loading", displayTotal: null, rows: [] };
  }
  if (state.status !== "ready") {
    return {
      status: "unavailable",
      displayTotal: null,
      totalStatus: "unavailable",
      statusLabel: "Balance unavailable",
      rows: [],
    };
  }

  const total = selectTotal(state.snapshot);
  const noCurrency = total.status === "no-quote-currency";
  const unavailable = total.status === "unavailable";
  return {
    status: "ready",
    displayTotal: total.value && total.currency
      ? formatPresentationFiat(total.value, total.currency, 2, state.snapshot.region)
      : "—",
    totalStatus: total.status === "partial"
      ? "partial"
      : noCurrency || unavailable
        ? "unavailable"
        : "complete",
    statusLabel: noCurrency
      ? "Choose a country in Account to set how money is shown"
      : unavailable
        ? "Balance unavailable"
        : undefined,
    rows: presentBalanceRows(state.snapshot),
    ...(state.revalidating ? { revalidating: true as const } : {}),
  };
}

export function presentBalanceRows(snapshot: BalancesSnapshot): BalanceRowModel[] {
  const cashSelections = selectCash(snapshot);
  const selectedCashIds = new Set(
    cashSelections.flatMap((entry) => entry.kind === "holding" ? [entry.holding.id] : []),
  );
  const cash = cashSelections.map((entry) => presentCash(entry, snapshot));
  const priced: Array<{ row: BalanceRowModel; value: ExactDecimal }> = [];
  const unpriced: BalanceRowModel[] = [];
  const dust: BalanceRowModel[] = [];

  for (const holding of snapshot.holdings) {
    if (
      holding.kind === "vault-share" ||
      selectedCashIds.has(holding.id) ||
      holding.balance.status !== "ready" ||
      holding.balance.baseUnits === "0"
    ) continue;
    if (holding.cashCurrency !== null) {
      cash.push(presentCash({ kind: "holding", holding }, snapshot));
      selectedCashIds.add(holding.id);
      continue;
    }
    const row = presentAsset(holding, snapshot);
    if (holding.value.status === "priced") {
      if (isAtLeastOneCent(holding.value.amount)) priced.push({ row, value: holding.value.amount });
      else dust.push(row);
    } else {
      unpriced.push(row);
    }
  }

  priced.sort((left, right) => compareExactDecimals(right.value, left.value) || compareRows(left.row, right.row));
  unpriced.sort(compareRows);
  dust.sort(compareRows);
  return [...cash, ...priced.map(({ row }) => row), ...unpriced, ...dust];
}

function presentCash(entry: CashSelection, snapshot: BalancesSnapshot): BalanceRowModel {
  if (entry.kind === "unsupported") {
    return {
      key: entry.key,
      group: "cash",
      name: entry.name,
      mark: { kind: "flag", currency: entry.currency },
      primary: formatPresentationFiat({ atoms: "0", scale: 2 }, entry.currency, 2, snapshot.region),
      secondary: null,
      tone: "default",
    };
  }
  const { holding } = entry;
  const currency = holding.cashCurrency!;
  if (holding.balance.status === "unavailable" || holding.cashValue?.status === "unavailable") {
    return {
      key: holding.key,
      group: "cash",
      name: presentationCurrencyName(currency),
      mark: { kind: "flag", currency },
      primary: "Unavailable",
      secondary: null,
      tone: "error",
    };
  }
  if (holding.cashValue?.status === "priced") {
    return {
      key: holding.key,
      group: "cash",
      name: presentationCurrencyName(currency),
      mark: { kind: "flag", currency },
      primary: formatPresentationFiat(holding.cashValue.amount, currency, 2, snapshot.region),
      secondary: null,
      tone: "default",
    };
  }
  return {
    key: holding.key,
    group: "cash",
    name: presentationCurrencyName(currency),
    mark: { kind: "flag", currency },
    primary: tokenQuantity(holding, snapshot),
    secondary: null,
    tone: "muted",
  };
}

function presentAsset(holding: Holding, snapshot: BalancesSnapshot): BalanceRowModel {
  const quantity = tokenQuantity(holding, snapshot);
  const mark: BalanceRowModel["mark"] = holding.imageUrl
    ? { kind: "image", url: holding.imageUrl, fallbackSymbol: holding.symbol }
    : holding.kind === "native"
      ? { kind: "eth" }
      : { kind: "symbol", symbol: holding.symbol };
  if (holding.value.status === "priced") {
    return {
      key: holding.key,
      group: "asset",
      name: holding.name,
      mark,
      primary: formatPresentationFiat(holding.value.amount, holding.value.currency, 2, snapshot.region),
      secondary: quantity,
      tone: "default",
    };
  }
  return {
    key: holding.key,
    group: "asset",
    name: holding.name,
    mark,
    primary: quantity,
    secondary: null,
    tone: "muted",
  };
}

function tokenQuantity(holding: Holding, snapshot: BalancesSnapshot): string {
  if (holding.balance.status !== "ready") return "Unavailable";
  return formatPresentationTokenAmount(
    BigInt(holding.balance.baseUnits),
    holding.decimals,
    holding.symbol,
    {
      cashCurrency: holding.cashCurrency,
      category: holding.kind === "native" ? "crypto" : undefined,
      regionId: snapshot.region,
    },
  );
}

function isAtLeastOneCent(value: ExactDecimal): boolean {
  const fraction = exactDecimalToFraction(value);
  return fraction.numerator * BigInt(100) >= fraction.denominator;
}

function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const leftFraction = exactDecimalToFraction(left);
  const rightFraction = exactDecimalToFraction(right);
  const leftScaled = leftFraction.numerator * rightFraction.denominator;
  const rightScaled = rightFraction.numerator * leftFraction.denominator;
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function compareRows(left: BalanceRowModel, right: BalanceRowModel): number {
  return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
}
