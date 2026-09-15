import type { FiatCurrencyCode } from "@/config/regions";
import {
  formatPresentationFiat,
  formatPresentationTokenAmount,
  formatRelativeTime,
  presentationCurrencyName,
} from "@/shared/formatting";
import { exactDecimalToFraction } from "@/shared/balances/math";
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
  label: "Cash" | "Investments" | "Savings";
  value: string;
  weight: number;
};

export type BalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  totalStatus?: "complete" | "partial" | "unavailable";
  statusLabel?: string;
  groups: MoneyGroupPresentation[];
  breakdown: MoneyBreakdownItem[];
  rows: BalanceRowModel[];
  hiddenRows: BalanceRowModel[];
  hiddenCount: number;
  revalidating?: true;
};

export type PresentBalancesOptions = {
  showSmallBalances: boolean;
  nowMs?: number;
};

export const HOME_MONEY_GROUP_PREVIEW_COUNT = 3;
export const HOME_BALANCES_HUB_PREVIEW_COUNT = 4;

export function previewBalanceRows(
  rows: readonly BalanceRowModel[],
  hiddenRows: readonly BalanceRowModel[] = [],
  limit = HOME_BALANCES_HUB_PREVIEW_COUNT,
): readonly BalanceRowModel[] {
  if (hiddenRows.length === 0) return rows.slice(0, limit);
  const hiddenKeys = new Set(hiddenRows.map((row) => row.key));
  return rows.filter((row) => !hiddenKeys.has(row.key)).slice(0, limit);
}

export function presentBalances(
  state: BalancesState,
  { showSmallBalances, nowMs = Date.now() }: PresentBalancesOptions = {
    showSmallBalances: false,
  },
): BalancesPresentation {
  if (state.status === "loading") {
    return {
      status: "loading",
      displayTotal: null,
      groups: [],
      breakdown: [],
      rows: [],
      hiddenRows: [],
      hiddenCount: 0,
    };
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
      hiddenRows: [],
      hiddenCount: 0,
    };
  }

  const total = selectTotal(state.snapshot);
  const noCurrency = total.status === "no-quote-currency";
  const unavailable = total.status === "unavailable";
  const partitions = presentMoneyGroupPartitions(state.snapshot);
  const investmentRows = showSmallBalances
    ? [...partitions.investmentRows, ...partitions.hiddenRows]
    : partitions.investmentRows;
  const groups = buildMoneyGroups(
    state.snapshot,
    partitions.cashSelections,
    partitions.investmentHoldings,
    partitions.cashRows,
    investmentRows,
  );
  const breakdown = presentBreakdown(
    state.snapshot,
    partitions.cashSelections,
    partitions.investmentHoldings,
  );

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
      : state.snapshot.stale === true
        ? `Updated ${formatRelativeTime(state.snapshot.fetchedAt, nowMs)}`
        : unavailable
          ? "Balance unavailable"
          : undefined,
    groups,
    breakdown,
    rows: groups.flatMap((group) => group.rows),
    hiddenRows: partitions.hiddenRows,
    hiddenCount: partitions.hiddenRows.length,
    ...(state.revalidating ? { revalidating: true as const } : {}),
  };
}

export function presentMoneyGroups(snapshot: BalancesSnapshot): MoneyGroupPresentation[] {
  const partitions = presentMoneyGroupPartitions(snapshot);
  return buildMoneyGroups(
    snapshot,
    partitions.cashSelections,
    partitions.investmentHoldings,
    partitions.cashRows,
    [...partitions.investmentRows, ...partitions.hiddenRows],
  );
}

export function presentBalanceRows(snapshot: BalancesSnapshot): BalanceRowModel[] {
  return presentMoneyGroups(snapshot).flatMap((group) => group.rows);
}

function presentMoneyGroupPartitions(snapshot: BalancesSnapshot): {
  cashSelections: CashSelection[];
  investmentHoldings: Holding[];
  cashRows: BalanceRowModel[];
  investmentRows: BalanceRowModel[];
  hiddenRows: BalanceRowModel[];
} {
  const selected = selectMoneyGroups(snapshot);
  const cashRows = selected.cash.map((entry) => presentCash(entry, snapshot));
  const investmentRows: BalanceRowModel[] = [];
  const hiddenRows: BalanceRowModel[] = [];

  for (const holding of selected.investments) {
    const row = presentAsset(holding, snapshot);
    if (
      (holding.value.status === "priced" && !isAtLeastOneCent(holding.value.amount)) ||
      (holding.value.status !== "priced" && holding.source === "wallet")
    ) {
      hiddenRows.push(row);
    } else {
      investmentRows.push(row);
    }
  }
  hiddenRows.sort(compareRows);

  return {
    cashSelections: selected.cash,
    investmentHoldings: selected.investments,
    cashRows,
    investmentRows,
    hiddenRows,
  };
}

function buildMoneyGroups(
  snapshot: BalancesSnapshot,
  cashSelections: readonly CashSelection[],
  investmentHoldings: readonly Holding[],
  cashRows: BalanceRowModel[],
  investmentRows: BalanceRowModel[],
): MoneyGroupPresentation[] {
  const groups: MoneyGroupPresentation[] = [{
    id: "cash",
    label: "Cash",
    displaySubtotal: presentCashSubtotal(cashSelections, snapshot),
    rows: cashRows,
  }];
  if (investmentRows.length > 0) {
    groups.push({
      id: "investments",
      label: "Investments",
      displaySubtotal: presentHoldingsSubtotal(investmentHoldings, snapshot),
      rows: investmentRows,
    });
  }
  return groups;
}

function presentBreakdown(
  snapshot: BalancesSnapshot,
  cashSelections: readonly CashSelection[],
  investmentHoldings: readonly Holding[],
): MoneyBreakdownItem[] {
  const items: Array<Omit<MoneyBreakdownItem, "weight"> & { amount: ExactDecimal }> = [];
  const cashHoldings = cashSelections.flatMap((entry) =>
    entry.kind === "holding" ? [entry.holding] : [],
  );
  appendBreakdownItem(items, "cash", "Cash", cashHoldings, snapshot);
  const savedHoldings = selectSavedHoldings(snapshot);
  if (savedHoldings.length > 0) {
    appendBreakdownItem(items, "saved", "Savings", savedHoldings, snapshot);
  }
  appendBreakdownItem(items, "investments", "Investments", investmentHoldings, snapshot);

  const normalizedAtoms = normalizedBreakdownAtoms(items);
  const maximumAtoms = normalizedAtoms.reduce(
    (maximum, atoms) => atoms > maximum ? atoms : maximum,
    BigInt(0),
  );

  return items.map((item, index) => ({
    id: item.id,
    label: item.label,
    value: item.value,
    weight: maximumAtoms === BigInt(0)
      ? 1
      : Math.max(1, Number((normalizedAtoms[index]! * BigInt(1_000)) / maximumAtoms)),
  }));
}

function appendBreakdownItem(
  items: Array<Omit<MoneyBreakdownItem, "weight"> & { amount: ExactDecimal }>,
  id: MoneyBreakdownItem["id"],
  label: MoneyBreakdownItem["label"],
  holdings: readonly Holding[],
  snapshot: BalancesSnapshot,
): void {
  const amount = holdingsSubtotalAmount(holdings, snapshot);
  if (!amount || !snapshot.quoteCurrency) return;
  items.push({
    id,
    label,
    value: formatPresentationFiat(amount, snapshot.quoteCurrency, 2, snapshot.region),
    amount,
  });
}

function normalizedBreakdownAtoms(
  items: readonly { amount: ExactDecimal }[],
): bigint[] {
  const scale = items.reduce((maximum, item) => Math.max(maximum, item.amount.scale), 0);
  return items.map(({ amount }) =>
    BigInt(amount.atoms) * BigInt(10) ** BigInt(scale - amount.scale),
  );
}

export function presentSavedSubtotal(snapshot: BalancesSnapshot): string | null {
  const holdings = selectSavedHoldings(snapshot);
  return holdings.length > 0 ? presentHoldingsSubtotal(holdings, snapshot) : null;
}

function selectSavedHoldings(snapshot: BalancesSnapshot): Holding[] {
  return snapshot.holdings.filter((holding) =>
    holding.kind === "vault-share" &&
    holding.balance.status === "ready" &&
    holding.balance.baseUnits !== "0"
  );
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
  const amount = holdingsSubtotalAmount(holdings, snapshot);
  return amount && snapshot.quoteCurrency
    ? formatPresentationFiat(amount, snapshot.quoteCurrency, 2, snapshot.region)
    : null;
}

function holdingsSubtotalAmount(
  holdings: readonly Holding[],
  snapshot: BalancesSnapshot,
): ExactDecimal | null {
  if (!snapshot.quoteCurrency) return null;
  const values = holdings.flatMap((holding) =>
    holding.value.status === "priced" ? [holding.value.amount] : []
  );
  if (values.length === 0 && holdings.length > 0) return null;
  return sumExactDecimals(values);
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

function isAtLeastOneCent(value: ExactDecimal): boolean {
  const fraction = exactDecimalToFraction(value);
  return fraction.numerator * BigInt(100) >= fraction.denominator;
}

function compareRows(left: BalanceRowModel, right: BalanceRowModel): number {
  return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
}
