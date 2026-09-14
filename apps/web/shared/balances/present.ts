import type { FiatCurrencyCode } from "@/config/regions";
import { formatPresentationTokenAmount } from "@/shared/formatting";
import {
  formatPresentationFiat,
  presentationCurrencyName,
} from "@/shared/portfolio/valuation-format";
import { selectMoneyGroups, selectTotal, type CashSelection } from "./select";
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

export type MoneyGroupPresentation = {
  id: "cash" | "investments";
  label: "Cash" | "Investments";
  displaySubtotal: string | null;
  rows: BalanceRowModel[];
};

export type MoneyBreakdownItem = {
  id: "cash" | "investments" | "saved";
  label: "Cash" | "Investments" | "Saved";
  value: string;
};

export type BalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  totalStatus?: "complete" | "partial" | "unavailable";
  statusLabel?: string;
  groups: MoneyGroupPresentation[];
  breakdown: MoneyBreakdownItem[];
  rows: BalanceRowModel[];
  revalidating?: true;
};

export const HOME_MONEY_GROUP_PREVIEW_COUNT = 3;

export function presentBalances(state: BalancesState): BalancesPresentation {
  if (state.status === "loading") {
    return { status: "loading", displayTotal: null, groups: [], breakdown: [], rows: [] };
  }
  if (state.status !== "ready") {
    return {
      status: "unavailable",
      displayTotal: null,
      totalStatus: "unavailable",
      statusLabel: "Balance unavailable",
      groups: [],
      breakdown: [],
      rows: [],
    };
  }

  const total = selectTotal(state.snapshot);
  const noCurrency = total.status === "no-quote-currency";
  const unavailable = total.status === "unavailable";
  const groups = presentMoneyGroups(state.snapshot);
  const breakdown = groups.flatMap((group): MoneyBreakdownItem[] =>
    group.displaySubtotal
      ? [{ id: group.id, label: group.label, value: group.displaySubtotal }]
      : []
  );
  // Saved uses the same quote-currency subtotal as Cash and Investments; vault shares are
  // priced holdings in the snapshot, so the three figures share currency, precision, and the
  // unpriced rule (omitted, never 0).
  const savedSubtotal = presentSavedSubtotal(state.snapshot);
  if (savedSubtotal) {
    breakdown.push({ id: "saved", label: "Saved", value: savedSubtotal });
  }
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
    groups,
    breakdown,
    rows: groups.flatMap((group) => group.rows),
    ...(state.revalidating ? { revalidating: true as const } : {}),
  };
}

export function presentMoneyGroups(snapshot: BalancesSnapshot): MoneyGroupPresentation[] {
  const selected = selectMoneyGroups(snapshot);
  const cashRows = selected.cash.map((entry) => presentCash(entry, snapshot));
  const investmentRows = selected.investments.map((holding) => presentAsset(holding, snapshot));
  const groups: MoneyGroupPresentation[] = [{
    id: "cash",
    label: "Cash",
    displaySubtotal: presentCashSubtotal(selected.cash, snapshot),
    rows: cashRows,
  }];
  if (investmentRows.length > 0) {
    groups.push({
      id: "investments",
      label: "Investments",
      displaySubtotal: presentHoldingsSubtotal(selected.investments, snapshot),
      rows: investmentRows,
    });
  }
  return groups;
}

export function presentBalanceRows(snapshot: BalancesSnapshot): BalanceRowModel[] {
  return presentMoneyGroups(snapshot).flatMap((group) => group.rows);
}

export function presentSavedSubtotal(snapshot: BalancesSnapshot): string | null {
  const vaultShares = snapshot.holdings.filter((holding) =>
    holding.kind === "vault-share" &&
    holding.balance.status === "ready" &&
    holding.balance.baseUnits !== "0"
  );
  return vaultShares.length > 0 ? presentHoldingsSubtotal(vaultShares, snapshot) : null;
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
    primary: tokenQuantity(holding, snapshot, currency),
    secondary: null,
    tone: "default",
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

function presentCashSubtotal(
  entries: readonly CashSelection[],
  snapshot: BalancesSnapshot,
): string | null {
  return presentHoldingsSubtotal(
    entries.flatMap((entry) => entry.kind === "holding" ? [entry.holding] : []),
    snapshot,
  );
}

function presentHoldingsSubtotal(
  holdings: readonly Holding[],
  snapshot: BalancesSnapshot,
): string | null {
  if (!snapshot.quoteCurrency) return null;
  const values = holdings.flatMap((holding) =>
    holding.value.status === "priced" ? [holding.value.amount] : []
  );
  if (values.length === 0 && holdings.length > 0) return null;
  const sum = sumExactDecimals(values);
  return formatPresentationFiat(sum, snapshot.quoteCurrency, 2, snapshot.region);
}

function sumExactDecimals(values: readonly ExactDecimal[]): ExactDecimal {
  const scale = values.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const atoms = values.reduce(
    (sum, value) => sum + BigInt(value.atoms) * BigInt(10) ** BigInt(scale - value.scale),
    BigInt(0),
  );
  return { atoms: atoms.toString(), scale };
}

function tokenQuantity(
  holding: Holding,
  snapshot: BalancesSnapshot,
  symbol = holding.symbol,
): string {
  if (holding.balance.status !== "ready") return "Unavailable";
  return formatPresentationTokenAmount(
    BigInt(holding.balance.baseUnits),
    holding.decimals,
    symbol,
    {
      cashCurrency: holding.cashCurrency,
      category: holding.kind === "native" ? "crypto" : undefined,
      regionId: snapshot.region,
    },
  );
}
