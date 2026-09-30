import { addFractions, exactDecimalToFraction, roundFractionPreservingPositive } from "./math";
import { isInvestmentHolding, selectCollateralHoldings, selectInvestmentHoldings } from "./select";
import type { AssetKey, BalancesSnapshot, BorrowCollateralHolding, ExactDecimal, Holding } from "./types";

const investmentNameCollator = new Intl.Collator("en", { sensitivity: "base" });

export type OwnedInvestment = {
  key: AssetKey;
  holding: Holding;
  wallet: Holding | null;
  availableZero: Holding | null;
  collateral: BorrowCollateralHolding[];
  amount: ExactDecimal | null;
};

function availableHolding(holding: Holding) {
  return holding.cashCurrency === null && holding.kind !== "vault-share" && !holding.collateral && holding.source !== "borrow";
}

function investmentAmount(holdings: Holding[]): ExactDecimal | null {
  const values = [];
  for (const holding of holdings) {
    if (holding.balance.status !== "ready" || holding.value.status !== "priced") return null;
    values.push(exactDecimalToFraction(holding.value.amount));
  }
  return roundFractionPreservingPositive(addFractions(values));
}

function ownedInvestments(snapshot: BalancesSnapshot, selectedKey?: AssetKey): OwnedInvestment[] {
  const wallet = selectInvestmentHoldings(snapshot).filter((holding) => selectedKey === undefined || holding.key === selectedKey);
  const rows = new Map<AssetKey, OwnedInvestment>();
  for (const holding of wallet) rows.set(holding.key, { key: holding.key, holding, wallet: holding, availableZero: null, collateral: [], amount: null });
  for (const holding of selectCollateralHoldings(snapshot)) {
    if (selectedKey !== undefined && holding.key !== selectedKey) continue;
    const row = rows.get(holding.key);
    if (row) row.collateral.push(holding);
    else rows.set(holding.key, { key: holding.key, holding, wallet: null, availableZero: null, collateral: [holding], amount: null });
  }
  for (const row of rows.values()) {
    if (row.wallet || !row.collateral.length) continue;
    const available = snapshot.holdings.find((holding) => holding.key === row.key && availableHolding(holding));
    if (available?.balance.status === "unavailable") row.wallet = available;
    else if (available?.balance.status === "ready" && available.balance.baseUnits === "0") row.availableZero = available;
  }
  return [...rows.values()].map((row) => {
    const holdings = [...(row.wallet ? [row.wallet] : []), ...row.collateral];
    return { ...row, amount: investmentAmount(holdings) };
  });
}

type OrderedInvestment = { row: OwnedInvestment; fraction: ReturnType<typeof exactDecimalToFraction> | null };

function compareInvestments(a: OrderedInvestment, b: OrderedInvestment) {
  if (a.fraction && b.fraction) {
    const difference = b.fraction.numerator * a.fraction.denominator - a.fraction.numerator * b.fraction.denominator;
    if (difference !== BigInt(0)) return difference > BigInt(0) ? 1 : -1;
  } else if (a.fraction || b.fraction) return a.fraction ? -1 : 1;
  const nameOrder = investmentNameCollator.compare(a.row.holding.name || a.row.holding.symbol, b.row.holding.name || b.row.holding.symbol);
  return nameOrder || (a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0);
}

export function* investmentSelection(snapshot: BalancesSnapshot): Generator<void, OwnedInvestment[]> {
  const rows = new Map<AssetKey, OwnedInvestment>();
  const available = new Map<AssetKey, Holding>();
  let work = 0;
  for (const holding of snapshot.holdings) {
    if (availableHolding(holding)) available.set(holding.key, holding);
    if (isInvestmentHolding(holding)) rows.set(holding.key, { key: holding.key, holding, wallet: holding, availableZero: null, collateral: [], amount: null });
    if (++work % 128 === 0) yield;
  }
  for (const holding of selectCollateralHoldings(snapshot)) {
    const row = rows.get(holding.key);
    if (row) row.collateral.push(holding);
    else rows.set(holding.key, { key: holding.key, holding, wallet: null, availableZero: null, collateral: [holding], amount: null });
  }
  let ordered: OrderedInvestment[] = [];
  for (const row of rows.values()) {
    if (!row.wallet && row.collateral.length) {
      const holding = available.get(row.key);
      if (holding?.balance.status === "unavailable") row.wallet = holding;
      else if (holding?.balance.status === "ready" && holding.balance.baseUnits === "0") row.availableZero = holding;
    }
    const holdings = [...(row.wallet ? [row.wallet] : []), ...row.collateral];
    row.amount = investmentAmount(holdings);
    ordered.push({ row, fraction: row.amount ? exactDecimalToFraction(row.amount) : null });
    if (++work % 128 === 0) yield;
  }
  for (let start = 0; start < ordered.length; start += 128) {
    const chunk = ordered.slice(start, start + 128).sort(compareInvestments);
    let index = start;
    for (const entry of chunk) ordered[index++] = entry;
    yield;
  }
  for (let width = 128; width < ordered.length; width *= 2) {
    const merged: OrderedInvestment[] = [];
    for (let start = 0; start < ordered.length; start += width * 2) {
      const middle = Math.min(start + width, ordered.length);
      const end = Math.min(start + width * 2, ordered.length);
      let left = start;
      let right = middle;
      while (left < middle || right < end) {
        const leftRow = left < middle ? ordered[left] : undefined;
        const rightRow = right < end ? ordered[right] : undefined;
        if (leftRow && (!rightRow || compareInvestments(leftRow, rightRow) <= 0)) {
          merged.push(leftRow);
          left++;
        } else if (rightRow) {
          merged.push(rightRow);
          right++;
        } else throw new Error("Investment selection has an incomplete sort run.");
        if (++work % 128 === 0) yield;
      }
    }
    ordered = merged;
  }
  const result: OwnedInvestment[] = [];
  for (const entry of ordered) {
    result.push(entry.row);
    if (++work % 128 === 0) yield;
  }
  return result;
}

export function selectOwnedInvestments(snapshot: BalancesSnapshot): OwnedInvestment[] {
  const selection = investmentSelection(snapshot);
  let next = selection.next();
  while (!next.done) next = selection.next();
  return next.value;
}

export function selectOwnedInvestment(snapshot: BalancesSnapshot, key: AssetKey): OwnedInvestment | null {
  const row = ownedInvestments(snapshot, key)[0];
  if (row) return row;
  const holding = snapshot.holdings.find((item) => item.key === key && availableHolding(item) && item.balance.status === "ready" && item.balance.baseUnits === "0");
  return holding ? { key, holding, wallet: holding, availableZero: holding, collateral: [], amount: holding.value.status === "priced" ? holding.value.amount : null } : null;
}
