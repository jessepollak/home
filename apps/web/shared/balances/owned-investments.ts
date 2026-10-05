import type { BalanceFigureStatus } from "./present";
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
  status: BalanceFigureStatus;
};

function availableHolding(holding: Holding) {
  return holding.cashCurrency === null && holding.kind !== "vault-share" && !holding.collateral && holding.source !== "borrow";
}

function investmentAmount(holdings: Holding[], snapshot: BalancesSnapshot): Pick<OwnedInvestment, "amount" | "status"> {
  if (!snapshot.quoteCurrency || holdings.some((holding) => holding.value.status === "unpriced" && holding.value.reason === "no-quote-currency")) {
    return { status: "unavailable", amount: null };
  }
  const values = [];
  let missing = false;
  for (const holding of holdings) {
    if (holding.balance.status !== "ready") missing = true;
    else if (holding.value.status === "priced") values.push(exactDecimalToFraction(holding.value.amount));
    else if (BigInt(holding.balance.baseUnits) > BigInt(0)) missing = true;
  }
  const sum = addFractions(values);
  const status = !missing ? "complete" : sum.numerator > BigInt(0) ? "partial" : "unavailable";
  return { status, amount: status === "unavailable" ? null : roundFractionPreservingPositive(sum) };
}

function ownedInvestments(snapshot: BalancesSnapshot, selectedKey?: AssetKey): OwnedInvestment[] {
  const wallet = selectInvestmentHoldings(snapshot).filter((holding) => selectedKey === undefined || holding.key === selectedKey);
  const rows = new Map<AssetKey, OwnedInvestment>();
  for (const holding of wallet) rows.set(holding.key, { key: holding.key, holding, wallet: holding, availableZero: null, collateral: [], amount: null, status: "unavailable" });
  for (const holding of selectCollateralHoldings(snapshot)) {
    if (selectedKey !== undefined && holding.key !== selectedKey) continue;
    const row = rows.get(holding.key);
    if (row) row.collateral.push(holding);
    else rows.set(holding.key, { key: holding.key, holding, wallet: null, availableZero: null, collateral: [holding], amount: null, status: "unavailable" });
  }
  for (const row of rows.values()) {
    if (row.wallet || !row.collateral.length) continue;
    const available = snapshot.holdings.find((holding) => holding.key === row.key && availableHolding(holding));
    if (available?.balance.status === "unavailable") row.wallet = available;
    else if (available?.balance.status === "ready" && available.balance.baseUnits === "0") row.availableZero = available;
  }
  return [...rows.values()].map((row) => {
    const holdings = [...(row.wallet ? [row.wallet] : []), ...row.collateral];
    return { ...row, ...investmentAmount(holdings, snapshot) };
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
    if (isInvestmentHolding(holding)) rows.set(holding.key, { key: holding.key, holding, wallet: holding, availableZero: null, collateral: [], amount: null, status: "unavailable" });
    if (++work % 128 === 0) yield;
  }
  for (const holding of selectCollateralHoldings(snapshot)) {
    const row = rows.get(holding.key);
    if (row) row.collateral.push(holding);
    else rows.set(holding.key, { key: holding.key, holding, wallet: null, availableZero: null, collateral: [holding], amount: null, status: "unavailable" });
  }
  let ordered: OrderedInvestment[] = [];
  for (const row of rows.values()) {
    if (!row.wallet && row.collateral.length) {
      const holding = available.get(row.key);
      if (holding?.balance.status === "unavailable") row.wallet = holding;
      else if (holding?.balance.status === "ready" && holding.balance.baseUnits === "0") row.availableZero = holding;
    }
    const holdings = [...(row.wallet ? [row.wallet] : []), ...row.collateral];
    Object.assign(row, investmentAmount(holdings, snapshot));
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
  return holding ? { key, holding, wallet: holding, availableZero: holding, collateral: [], ...investmentAmount([holding], snapshot) } : null;
}
