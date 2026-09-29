import { findInvestAssetByAddress } from "@/config/invest-assets";
import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import { weightedAprWad } from "@/shared/borrowing/math";
import {
  formatPresentationFiat,
  formatPresentationTokenAmount,
  formatWadPercent,
  presentationCurrencyName,
} from "@/shared/formatting";
import { exactDecimalToFraction } from "@/shared/balances/math";
import { pricePendingCashout, type PendingCashoutEstimate } from "./pending-cashout";
import { selectOwnedInvestments } from "./owned-investments";
import {
  selectBalanceTotals,
  selectBorrowPositions,
  selectCollateralHoldings,
  selectMoneyGroups,
  type CashSelection,
} from "./select";
import type {
  BalancesSnapshot,
  BalancesState,
  BalancesTotal,
  BorrowPosition,
  ExactDecimal,
  Holding,
} from "./types";

const rowNameCollator = new Intl.Collator("en", { sensitivity: "base" });

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
  id: "cash" | "investments" | "unpriced";
  label: "Cash" | "Investments" | "Unpriced";
  displaySubtotal: string | null;
  rows: BalanceRowModel[];
};

export type MoneyBreakdownItem = {
  id: "borrow" | "cash" | "pending-cash-out" | "investments";
  label: "Borrow" | "Cash" | "Pending cash-out" | "Investments";
  value: string;
  weight: number;
};

export type HomeSummaryAmount = {
  status: "complete" | "partial" | "unavailable";
  value: string | null;
};

export type HomeMoneySummary = {
  cash: HomeSummaryAmount;
  investments: HomeSummaryAmount & { assetCount: number; ownedCount: number };
  borrow:
    | (HomeSummaryAmount & { kind: "position"; rate: string | null; debts: Array<{ marketId: string; baseUnits: string }> })
    | { kind: "none" }
    | { kind: "unavailable" };
};

export type BalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  totalStatus?: "complete" | "partial" | "unavailable";
  statusLabel?: string;
  needsCountry?: true;
  groups: MoneyGroupPresentation[];
  breakdown: MoneyBreakdownItem[];
  summary: HomeMoneySummary | null;
  rows: BalanceRowModel[];
  hiddenRows: BalanceRowModel[];
  hiddenCount: number;
  revalidating?: true;
};

export type PresentBalancesOptions = {
  showSmallBalances: boolean;
  pendingCashout?: PendingCashoutEstimate;
};

export function presentBalances(
  state: BalancesState,
  { showSmallBalances, pendingCashout }: PresentBalancesOptions = {
    showSmallBalances: false,
  },
): BalancesPresentation {
  if (state.status === "loading") {
    return {
      status: "loading",
      displayTotal: null,
      groups: [],
      breakdown: [],
      summary: null,
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
      summary: null,
      rows: [],
      hiddenRows: [],
      hiddenCount: 0,
    };
  }

  const net = selectBalanceTotals(state.snapshot).net;
  const pending = pendingCashout?.state === "escrow" && BigInt(pendingCashout.baseUnits) > BigInt(0)
    ? pricePendingCashout(state.snapshot, pendingCashout) : null;
  const pendingUnpriced = pending === "unpriced" || pendingCashout?.state === "escrow" && pendingCashout.partial ||
    pendingCashout?.state === "indeterminate" || pendingCashout?.state === "unreadable" || pendingCashout?.state === "loading";
  const pendingValue = pending && pending !== "unpriced" && BigInt(pending.atoms) > BigInt(0) ? pending : null;
  const noCurrency = net.status === "no-quote-currency";
  const unavailable = net.status === "unavailable";
  const combined = net.value && pendingValue ? signedNetWithPending(net.value, net.negative, pendingValue) : null;
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
    partitions.unpricedRows,
  );
  const summary = presentHomeSummary(state.snapshot, partitions);
  const breakdown = presentBreakdown(state.snapshot, pendingValue);

  return {
    status: "ready",
    displayTotal: net.value && net.currency
      ? `${(combined?.negative ?? net.negative) ? "−" : ""}${formatPresentationFiat(combined?.value ?? net.value, net.currency, 2, state.snapshot.region)}`
      : "—",
    totalStatus: net.status === "partial" || pendingUnpriced && !noCurrency && !unavailable
      ? "partial"
      : noCurrency || unavailable
        ? "unavailable"
        : "complete",
    statusLabel: noCurrency
      ? "Choose a country in Account to set how money is shown"
      : unavailable
        ? "Balance unavailable"
        : net.status === "partial" || pendingUnpriced
          ? "Some balances are unavailable"
          : undefined,
    ...(noCurrency ? { needsCountry: true as const } : {}),
    groups,
    breakdown,
    summary,
    rows: groups.flatMap((group) => group.rows),
    hiddenRows: partitions.hiddenRows,
    hiddenCount: partitions.hiddenRows.length,
    ...(state.revalidating ? { revalidating: true as const } : {}),
  };
}

export function presentPendingCashout(snapshot: BalancesSnapshot, escrow: PendingCashoutEstimate): { value: string | null } | null {
  if (escrow?.state === "indeterminate") return { value: null };
  if (escrow?.state !== "escrow" || BigInt(escrow.baseUnits) === BigInt(0)) return null;
  const amount = pricePendingCashout(snapshot, escrow);
  return amount === "unpriced" || BigInt(amount.atoms) === BigInt(0) || !snapshot.quoteCurrency
    ? null : { value: formatPresentationFiat(amount, snapshot.quoteCurrency, 2, snapshot.region) };
}

function signedNetWithPending(net: ExactDecimal, negative: boolean, pending: ExactDecimal): { value: ExactDecimal; negative: boolean } {
  const scale = Math.max(net.scale, pending.scale);
  const sum = (negative ? -scaledAtoms(net, scale) : scaledAtoms(net, scale)) + scaledAtoms(pending, scale);
  return { value: { atoms: (sum < BigInt(0) ? -sum : sum).toString(), scale }, negative: sum < BigInt(0) };
}

export function presentMoneyGroups(snapshot: BalancesSnapshot): MoneyGroupPresentation[] {
  const partitions = presentMoneyGroupPartitions(snapshot);
  return buildMoneyGroups(
    snapshot,
    partitions.cashSelections,
    partitions.investmentHoldings,
    partitions.cashRows,
    [...partitions.investmentRows, ...partitions.hiddenRows],
    partitions.unpricedRows,
  );
}

/** @public exercised by shared/balances/present.test.ts */
export function presentBalanceRows(snapshot: BalancesSnapshot): BalanceRowModel[] {
  return presentMoneyGroups(snapshot).flatMap((group) => group.rows);
}

function presentMoneyGroupPartitions(snapshot: BalancesSnapshot): {
  cashSelections: CashSelection[];
  cashRows: BalanceRowModel[];
  investmentRows: BalanceRowModel[];
  unpricedRows: BalanceRowModel[];
  hiddenRows: BalanceRowModel[];
  investmentHoldings: Holding[];
  visibleInvestmentHoldings: Holding[];
} {
  const selected = selectMoneyGroups(snapshot);
  const cashRows = selected.cash.map((entry) => presentCash(entry, snapshot));
  const investmentRows: BalanceRowModel[] = [];
  const unpricedRows: BalanceRowModel[] = [];
  const hiddenRows: BalanceRowModel[] = [];
  const visibleInvestmentHoldings: Holding[] = [];

  for (const holding of selected.investments) {
    const row = presentAsset(holding, snapshot);
    if (holding.balance.status === "ready" && holding.value.status === "priced" && !isAtLeastOneCent(holding.value.amount)) {
      hiddenRows.push(row);
    } else if (holding.balance.status === "ready" && holding.value.status !== "priced" && holding.source === "wallet") {
      unpricedRows.push(row);
    } else {
      investmentRows.push(row);
      if (holding.balance.status === "ready") visibleInvestmentHoldings.push(holding);
    }
  }
  hiddenRows.sort(compareRows);
  unpricedRows.sort(compareRows);

  return {
    cashSelections: selected.cash,
    cashRows,
    investmentRows,
    unpricedRows,
    hiddenRows,
    investmentHoldings: selected.investments,
    visibleInvestmentHoldings,
  };
}

function buildMoneyGroups(
  snapshot: BalancesSnapshot,
  cashSelections: readonly CashSelection[],
  investmentHoldings: readonly Holding[],
  cashRows: BalanceRowModel[],
  investmentRows: BalanceRowModel[],
  unpricedRows: BalanceRowModel[],
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
  if (unpricedRows.length > 0) {
    groups.push({ id: "unpriced", label: "Unpriced", displaySubtotal: null, rows: unpricedRows });
  }
  return groups;
}

function presentHomeSummary(
  snapshot: BalancesSnapshot,
  partitions: { visibleInvestmentHoldings: readonly Holding[] },
): HomeMoneySummary {
  const totals = selectBalanceTotals(snapshot);
  const collateral = selectCollateralHoldings(snapshot);
  const investmentHoldings = [...partitions.visibleInvestmentHoldings, ...collateral];
  const assetKeys = new Set(investmentHoldings.map((holding) => holding.key));
  return {
    cash: summaryAmount(totals.cash, snapshot.region),
    investments: {
      ...summaryAmount(totals.investments, snapshot.region),
      assetCount: assetKeys.size,
      ownedCount: selectOwnedInvestments(snapshot).filter((row) =>
        [row.wallet, ...row.collateral].some((holding) => holding?.balance.status === "ready"),
      ).length,
    },
    borrow: presentBorrowSummary(snapshot, totals.borrow),
  };
}

function presentBorrowSummary(
  snapshot: BalancesSnapshot,
  total: BalancesTotal,
): HomeMoneySummary["borrow"] {
  const owing = selectBorrowPositions(snapshot).filter((position) =>
    BigInt(position.debt.balance.baseUnits) > BigInt(0)
  );
  if (owing.length === 0) {
    return snapshot.borrow.coverage === "complete" ? { kind: "none" } : { kind: "unavailable" };
  }
  const rate = weightedBorrowAprWad(owing);
  return {
    kind: "position",
    ...summaryAmount(total, snapshot.region),
    rate: rate === null ? null : `${formatWadPercent(rate, snapshot.region)} APR`,
    debts: owing.map((position) => ({ marketId: position.marketId, baseUnits: position.debt.balance.baseUnits })),
  };
}

function weightedBorrowAprWad(positions: readonly BorrowPosition[]): string | null {
  const weights = borrowDebtWeights(positions);
  return weightedAprWad(positions.map((position, index) => ({
    weight: weights[index]!, aprWad: position.borrowAprWad,
  })));
}

function borrowDebtWeights(positions: readonly BorrowPosition[]): bigint[] {
  const values = positions.flatMap((position) =>
    position.debt.value.status === "priced" ? [position.debt.value.amount] : []
  );
  if (values.length === positions.length) {
    const scale = values.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
    return values.map((value) => scaledAtoms(value, scale));
  }
  const decimals = positions.reduce(
    (maximum, position) => Math.max(maximum, position.debt.asset.decimals),
    0,
  );
  return positions.map((position) =>
    BigInt(position.debt.balance.baseUnits) *
      BigInt(10) ** BigInt(decimals - position.debt.asset.decimals)
  );
}

function summaryAmount(total: BalancesTotal, region: RegionId): HomeSummaryAmount {
  if (
    (total.status === "complete" || total.status === "partial") &&
    total.value &&
    total.currency
  ) {
    return {
      status: total.status,
      value: formatPresentationFiat(total.value, total.currency, 2, region),
    };
  }
  return { status: "unavailable", value: null };
}

function presentBreakdown(snapshot: BalancesSnapshot, pending: ExactDecimal | null): MoneyBreakdownItem[] {
  const totals = selectBalanceTotals(snapshot);
  const hasDebt = selectBorrowPositions(snapshot).some((position) =>
    BigInt(position.debt.balance.baseUnits) > BigInt(0)
  );
  const entries: Array<{
    id: MoneyBreakdownItem["id"];
    label: MoneyBreakdownItem["label"];
    total: BalancesTotal;
    sign: "" | "−";
  }> = [
    ...(hasDebt
      ? [{ id: "borrow" as const, label: "Borrow" as const, total: totals.borrow, sign: "−" as const }]
      : []),
    { id: "cash", label: "Cash", total: totals.cash, sign: "" },
    ...(pending && snapshot.quoteCurrency ? [{ id: "pending-cash-out" as const, label: "Pending cash-out" as const,
      total: { value: pending, currency: snapshot.quoteCurrency, status: "complete" as const }, sign: "" as const }] : []),
    { id: "investments", label: "Investments", total: totals.investments, sign: "" },
  ];
  const known = entries.flatMap((entry) =>
    entry.total.value && entry.total.currency
      ? [{ ...entry, amount: entry.total.value, currency: entry.total.currency }]
      : [],
  );
  const scale = known.reduce((maximum, entry) => Math.max(maximum, entry.amount.scale), 0);
  const magnitudes = known.map((entry) => scaledAtoms(entry.amount, scale));
  const sum = magnitudes.reduce((total, value) => total + value, BigInt(0));
  if (sum <= BigInt(0)) return [];
  return known.map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    value: `${entry.sign}${formatPresentationFiat(entry.amount, entry.currency, 2, snapshot.region)}`,
    weight: Number((magnitudes[index]! * BigInt(2_000) + sum) / (sum * BigInt(2))),
  }));
}

function scaledAtoms(value: ExactDecimal, scale: number): bigint {
  return BigInt(value.atoms) * BigInt(10) ** BigInt(scale - value.scale);
}

export function presentHoldingMark(holding: Holding): BalanceRowModel["mark"] {
  return holding.imageUrl
    ? { kind: "image", url: holding.imageUrl, fallbackSymbol: holding.symbol }
    : holding.kind === "native"
      ? { kind: "eth" }
      : { kind: "symbol", symbol: holding.symbol };
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
  if (holding.balance.status === "unavailable") {
    return {
      key: holding.key,
      group: "asset",
      name: holding.name.trim() || holding.symbol.trim(),
      mark: presentHoldingMark(holding),
      primary: "Unavailable",
      secondary: null,
      tone: "error",
    };
  }
  const quantity = tokenQuantity(holding, snapshot);
  const mark = presentHoldingMark(holding);
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
      category: holding.kind === "native"
        ? "crypto"
        : holding.contractAddress
          ? findInvestAssetByAddress(holding.contractAddress)?.category
          : undefined,
      regionId: snapshot.region,
    },
  );
}

function isAtLeastOneCent(value: ExactDecimal): boolean {
  const fraction = exactDecimalToFraction(value);
  return fraction.numerator * BigInt(100) >= fraction.denominator;
}

function compareRows(left: BalanceRowModel, right: BalanceRowModel): number {
  return rowNameCollator.compare(left.name, right.name);
}

export function presentInvestmentTotal(snapshot: BalancesSnapshot): HomeSummaryAmount {
  return summaryAmount(selectBalanceTotals(snapshot).investments, snapshot.region);
}
