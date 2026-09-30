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
import {
  selectBalanceTotals,
  selectBorrowPositions,
  selectInvestmentHoldings,
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
import { holdingValueContext } from "./value-label";

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
  valueContext?: string;
  tone: "default" | "muted" | "error";
};

export type BalanceFigureStatus = "complete" | "partial" | "unavailable";
export type BalanceFigure =
  | { status: "complete" | "partial"; value: string }
  | { status: "unavailable"; value: null };

export type MoneyGroupPresentation = {
  id: "cash" | "investments" | "unpriced";
  label: "Cash" | "Investments" | "Unpriced";
  subtotal: BalanceFigure | null;
  rows: BalanceRowModel[];
};

export type MoneyBreakdownItem = {
  id: "borrow" | "cash" | "pending-cash-out" | "investments";
  label: "Borrow" | "Cash" | "Pending cash-out" | "Investments";
  weight: number;
} & BalanceFigure;

export type HomeMoneySummary = {
  cash: BalanceFigure & { statusLabel?: string };
  investments: BalanceFigure & { assetCount: number; ownedCount: number; statusLabel?: string };
  borrow:
    | (BalanceFigure & { kind: "position"; rate: string | null; debts: Array<{ marketId: string; baseUnits: string }> })
    | { kind: "none" }
    | { kind: "unavailable" };
};

export type HomeBalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  totalStatus?: BalanceFigureStatus;
  statusLabel?: string;
  statusDetails?: string[];
  needsCountry?: true;
  breakdown: MoneyBreakdownItem[];
  summary: HomeMoneySummary | null;
  revalidating?: true;
};

export type BalancesPresentation = HomeBalancesPresentation & {
  groups: MoneyGroupPresentation[];
  rows: BalanceRowModel[];
  hiddenRows: BalanceRowModel[];
  hiddenCount: number;
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
  const home = presentHomeBalances(state, { pendingCashout });
  if (state.status !== "ready") return { ...home, groups: [], rows: [], hiddenRows: [], hiddenCount: 0 };
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
  return { ...home, groups, rows: groups.flatMap((group) => group.rows), hiddenRows: partitions.hiddenRows, hiddenCount: partitions.hiddenRows.length };
}

export function presentHomeBalances(
  state: BalancesState,
  { pendingCashout }: Pick<PresentBalancesOptions, "pendingCashout"> = {},
): HomeBalancesPresentation {
  if (state.status === "loading") {
    return {
      status: "loading",
      displayTotal: null,
      breakdown: [],
      summary: null,
    };
  }
  if (state.status !== "ready") {
    return {
      status: "unavailable",
      displayTotal: null,
      totalStatus: "unavailable",
      statusLabel: "Balance unavailable",
      breakdown: [],
      summary: null,
    };
  }

  const net = selectBalanceTotals(state.snapshot).net;
  const pending = pendingCashout?.state === "escrow" && BigInt(pendingCashout.baseUnits) > BigInt(0)
    ? pricePendingCashout(state.snapshot, pendingCashout) : null;
  const pendingUnpriced = pending === "unpriced" || pendingCashout?.state === "escrow" && pendingCashout.partial ||
    pendingCashout?.state === "indeterminate" || pendingCashout?.state === "unreadable" || pendingCashout?.state === "loading";
  const pendingValue = pending && pending !== "unpriced" && BigInt(pending.atoms) > BigInt(0) ? pending : null;
  const pendingPartial = pendingCashout?.state === "escrow" && pendingCashout.partial;
  const noCurrency = net.status === "no-quote-currency";
  const unpricedDebt = selectBorrowPositions(state.snapshot).some((position) =>
    BigInt(position.debt.balance.baseUnits) > BigInt(0) && position.debt.value.status !== "priced"
  );
  const unavailable = net.status === "unavailable" || unpricedDebt;
  const combined = net.value && pendingValue ? signedNetWithPending(net.value, net.negative, pendingValue) : null;
  const totalStatus: BalanceFigureStatus = noCurrency || unavailable
    ? "unavailable"
    : net.status === "partial" || pendingUnpriced || state.snapshot.borrow.coverage !== "complete"
      ? "partial"
      : "complete";
  const summary = presentHomeSummary(state.snapshot);
  const breakdown = presentBreakdown(state.snapshot, pendingValue ? { amount: pendingValue, partial: pendingPartial } : null);

  return {
    status: "ready",
    displayTotal: totalStatus !== "unavailable" && net.value && net.currency
      ? `${(combined?.negative ?? net.negative) ? "−" : ""}${formatPresentationFiat(combined?.value ?? net.value, net.currency, 2, state.snapshot.region)}`
      : "—",
    totalStatus,
    statusLabel: noCurrency
      ? "Choose a country in Account to set how money is shown"
      : unavailable
        ? "Balance unavailable"
        : totalStatus === "partial"
          ? "Partial balance"
          : undefined,
    ...(totalStatus === "partial" || unpricedDebt ? { statusDetails: balanceLimitations(state.snapshot, pendingCashout, pending === "unpriced") } : {}),
    ...(noCurrency ? { needsCountry: true as const } : {}),
    breakdown,
    summary,
    ...(state.revalidating ? { revalidating: true as const } : {}),
  };
}

function holdingLimitations(holdings: readonly Holding[]): string[] {
  const reasons = new Set<string>();
  for (const holding of holdings) {
    if (holding.balance.status === "unavailable") reasons.add("Some quantities unavailable");
    else if (BigInt(holding.balance.baseUnits) > BigInt(0) && holding.value.status !== "priced") {
      const context = holdingValueContext(holding.value);
      reasons.add(context === "Paused" ? "Price paused" : context ?? "Value unavailable");
    }
  }
  return [...reasons];
}

function supportingStatus(holdings: readonly Holding[]): string | undefined {
  const reasons = holdingLimitations(holdings);
  return reasons.length > 1 ? "Partial balance" : reasons[0];
}

function balanceLimitations(snapshot: BalancesSnapshot, pending?: PendingCashoutEstimate, pendingUnpriced = false): string[] {
  const reasons = holdingLimitations(snapshot.holdings);
  for (const { collateral } of snapshot.borrow.positions) {
    if (BigInt(collateral.balance.baseUnits) > BigInt(0) && collateral.value.status !== "priced") {
      const context = holdingValueContext(collateral.value) ?? "Value unavailable";
      if (!reasons.includes(context)) reasons.push(context);
    }
  }
  if (snapshot.coverage.catalog !== "complete") reasons.push("The full investment inventory could not be checked.");
  const owing = snapshot.borrow.positions.filter((position) => BigInt(position.debt.balance.baseUnits) > BigInt(0));
  if (owing.some((position) => position.debt.value.status !== "priced")) reasons.push("Loan value unavailable. Net balance cannot be calculated.");
  if (snapshot.borrow.coverage !== "complete") reasons.push(owing.length === 0
    ? "Home could not check whether you have a loan." : "Loan balances could not all be checked.");
  if (pendingUnpriced) reasons.push("Pending cash-out value unavailable.");
  if (pending && (pending.state === "loading" || pending.state === "unreadable" || pending.state === "indeterminate" || pending.state === "escrow" && pending.partial)) {
    reasons.push("Pending cash-out balances could not all be checked.");
  }
  return reasons.length > 0 ? reasons : ["Some balance values are unavailable."];
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

function presentMoneyGroupPartitions(snapshot: BalancesSnapshot): {
  cashSelections: CashSelection[];
  cashRows: BalanceRowModel[];
  investmentRows: BalanceRowModel[];
  unpricedRows: BalanceRowModel[];
  hiddenRows: BalanceRowModel[];
  investmentHoldings: Holding[];
} {
  const selected = selectMoneyGroups(snapshot);
  const cashRows = selected.cash.map((entry) => presentCashSelection(entry, snapshot));
  const investmentRows: BalanceRowModel[] = [];
  const unpricedRows: BalanceRowModel[] = [];
  const hiddenRows: BalanceRowModel[] = [];

  for (const holding of selected.investments) {
    const row = presentAsset(holding, snapshot);
    if (holding.balance.status === "ready" && holding.value.status === "priced" && !isAtLeastOneCent(holding.value.amount)) {
      hiddenRows.push(row);
    } else if (holding.balance.status === "ready" && holding.value.status !== "priced" && holding.source === "wallet") {
      unpricedRows.push(row);
    } else {
      investmentRows.push(row);
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
    subtotal: presentCashSubtotal(cashSelections, snapshot),
    rows: cashRows,
  }];
  const incompleteInvestments = snapshot.coverage.catalog !== "complete" || snapshot.holdings.some((holding) =>
    holding.cashCurrency === null && holding.kind !== "vault-share" && holding.balance.status === "unavailable"
  );
  const investmentFigure = presentHoldingsSubtotal(
    investmentHoldings.filter((holding) => holding.source !== "wallet" || holding.value.status === "priced"),
    snapshot,
    incompleteInvestments,
  );
  if (investmentRows.length > 0 || incompleteInvestments) {
    groups.push({
      id: "investments",
      label: "Investments",
      subtotal: investmentFigure,
      rows: investmentRows,
    });
  }
  if (unpricedRows.length > 0) {
    groups.push({ id: "unpriced", label: "Unpriced", subtotal: null, rows: unpricedRows });
  }
  return groups;
}

function presentHomeSummary(
  snapshot: BalancesSnapshot,
): HomeMoneySummary {
  const totals = selectBalanceTotals(snapshot);
  const assetKeys = new Set<string>();
  const owned = new Map<string, boolean>();
  for (const holding of selectInvestmentHoldings(snapshot)) {
    const ready = holding.balance.status === "ready";
    owned.set(holding.key, ready);
    if (!ready || holding.value.status === "priced" && !isAtLeastOneCent(holding.value.amount) ||
      holding.value.status !== "priced" && holding.source === "wallet") continue;
    assetKeys.add(holding.key);
  }
  for (const { collateral } of snapshot.borrow.positions) {
    if (collateral.balance.baseUnits === "0") continue;
    assetKeys.add(collateral.key);
    owned.set(collateral.key, true);
  }
  return {
    cash: { ...summaryAmount(totals.cash, snapshot.region),
      ...(totals.cash.status === "partial" ? { statusLabel: supportingStatus(snapshot.holdings.filter((holding) => holding.cashCurrency !== null || holding.kind === "vault-share")) ?? "Partial balance" } : {}) },
    investments: {
      ...summaryAmount(totals.investments, snapshot.region),
      assetCount: assetKeys.size,
      ownedCount: [...owned.values()].filter(Boolean).length,
      ...(totals.investments.status === "partial" ? { statusLabel: supportingStatus(snapshot.holdings.filter((holding) => holding.cashCurrency === null && holding.kind !== "vault-share"))
        ?? (snapshot.coverage.catalog !== "complete" ? "Inventory incomplete" : snapshot.borrow.coverage !== "complete" ? "Loan data incomplete" : "Partial balance") } : {}),
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

function summaryAmount(total: BalancesTotal, region: RegionId): BalanceFigure {
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

function presentBreakdown(snapshot: BalancesSnapshot, pending: { amount: ExactDecimal; partial: boolean } | null): MoneyBreakdownItem[] {
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
      total: { value: pending.amount, currency: snapshot.quoteCurrency, status: pending.partial ? "partial" as const : "complete" as const }, sign: "" as const }] : []),
    { id: "investments", label: "Investments", total: totals.investments, sign: "" },
  ];
  const known = entries.flatMap((entry) => {
    const { status, value, currency } = entry.total;
    return (status === "complete" || status === "partial") && value && currency
      ? [{ ...entry, status, amount: value, currency }]
      : [];
  });
  const scale = known.reduce((maximum, entry) => Math.max(maximum, entry.amount.scale), 0);
  const measured = known.map((entry) => ({ ...entry, magnitude: scaledAtoms(entry.amount, scale) }));
  const sum = measured.reduce((total, entry) => total + entry.magnitude, BigInt(0));
  if (sum <= BigInt(0)) return [];
  return entries.map((entry) => {
    const item = measured.find((candidate) => candidate.id === entry.id);
    if (!item) return { id: entry.id, label: entry.label, status: "unavailable", value: null, weight: 0 };
    return {
      id: item.id,
      label: item.label,
      status: item.status,
      value: `${item.sign}${formatPresentationFiat(item.amount, item.currency, 2, snapshot.region)}`,
      weight: Number((item.magnitude * BigInt(2_000) + sum) / (sum * BigInt(2))),
    };
  });
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

export function presentCashSelection(entry: CashSelection, snapshot: BalancesSnapshot): BalanceRowModel {
  if (entry.kind === "unsupported") {
    return {
      key: entry.key,
      group: "cash",
      name: entry.name,
      mark: { kind: "flag", currency: entry.currency },
      primary: "Verification pending",
      secondary: null,
      tone: "muted",
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
    valueContext: `— · ${holdingValueContext(holding.value) ?? "Value unavailable"}`,
    tone: "default",
  };
}

function presentCashSubtotal(
  entries: readonly CashSelection[],
  snapshot: BalancesSnapshot,
): BalanceFigure {
  return presentHoldingsSubtotal(
    entries.flatMap((entry) => entry.kind === "holding" ? [entry.holding] : []),
    snapshot,
    snapshot.holdings.some((holding) =>
      holding.cashCurrency !== null && holding.balance.status === "unavailable"
    ),
  );
}

function presentHoldingsSubtotal(
  holdings: readonly Holding[],
  snapshot: BalancesSnapshot,
  knownIncomplete = false,
): BalanceFigure {
  if (!snapshot.quoteCurrency) return { status: "unavailable", value: null };
  const incomplete = knownIncomplete || holdings.some((holding) =>
    holding.balance.status === "unavailable" || (
      holding.balance.status === "ready" && BigInt(holding.balance.baseUnits) > BigInt(0) &&
      holding.value.status !== "priced"
    )
  );
  const values = holdings.flatMap((holding) =>
    holding.value.status === "priced" ? [holding.value.amount] : []
  );
  const amount = sumExactDecimals(values);
  if (incomplete && BigInt(amount.atoms) === BigInt(0)) return { status: "unavailable", value: null };
  return {
    status: incomplete ? "partial" : "complete",
    value: formatPresentationFiat(amount, snapshot.quoteCurrency, 2, snapshot.region),
  };
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

export function presentInvestmentTotal(snapshot: BalancesSnapshot): BalanceFigure {
  return summaryAmount(selectBalanceTotals(snapshot).investments, snapshot.region);
}

export function presentCashTotal(snapshot: BalancesSnapshot): BalanceFigure {
  return summaryAmount(selectBalanceTotals(snapshot).cash, snapshot.region);
}
