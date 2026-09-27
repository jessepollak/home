import { addFractions, exactDecimalToFraction, roundFractionPreservingPositive } from "./math";
import { selectCollateralHoldings, selectMoneyGroups } from "./select";
import type { AssetKey, BalancesSnapshot, BorrowCollateralHolding, ExactDecimal, Holding } from "./types";

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

export function selectOwnedInvestments(snapshot: BalancesSnapshot): OwnedInvestment[] {
  const wallet = selectMoneyGroups(snapshot).investments;
  const rows = new Map<AssetKey, OwnedInvestment>();
  for (const holding of wallet) rows.set(holding.key, { key: holding.key, holding, wallet: holding, availableZero: null, collateral: [], amount: null });
  for (const holding of selectCollateralHoldings(snapshot)) {
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
    return { ...row, amount: holdings.every((holding) => holding.balance.status === "ready" && holding.value.status === "priced")
      ? roundFractionPreservingPositive(addFractions(holdings.map((holding) => exactDecimalToFraction((holding.value as Extract<Holding["value"], { status: "priced" }>).amount))))
      : null };
  }).sort((a, b) => {
    if (a.amount && b.amount) {
      const left = exactDecimalToFraction(a.amount);
      const right = exactDecimalToFraction(b.amount);
      const difference = right.numerator * left.denominator - left.numerator * right.denominator;
      if (difference !== BigInt(0)) return difference > BigInt(0) ? 1 : -1;
    } else if (a.amount || b.amount) return a.amount ? -1 : 1;
    const nameOrder = (a.holding.name || a.holding.symbol).localeCompare(b.holding.name || b.holding.symbol, "en", { sensitivity: "base" });
    return nameOrder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
}

export function selectOwnedInvestment(snapshot: BalancesSnapshot, key: AssetKey): OwnedInvestment | null {
  const row = selectOwnedInvestments(snapshot).find((item) => item.key === key);
  if (row) return row;
  const holding = snapshot.holdings.find((item) => item.key === key && availableHolding(item) && item.balance.status === "ready" && item.balance.baseUnits === "0");
  return holding ? { key, holding, wallet: holding, availableZero: holding, collateral: [], amount: holding.value.status === "priced" ? holding.value.amount : null } : null;
}
