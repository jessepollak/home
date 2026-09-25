import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import { borrowRiskDescription, borrowRiskState } from "../borrow-ui";
import { openingBorrowAvailableBaseUnits } from "../borrowing-experience";

export function summarizeBorrowOverview(overview: BorrowOverviewResponse) {
  let debt = BigInt(0);
  let weightedApr = BigInt(0);
  let loanToken: BorrowMarketSnapshot["market"]["loanToken"] | null = null;
  for (const opportunity of overview.opportunities) {
    if (opportunity.availability.status !== "available") continue;
    const snapshot = opportunity.availability.snapshot;
    const amount = BigInt(snapshot.position.debtAssetsRaw);
    if (amount === BigInt(0)) continue;
    const token = snapshot.market.loanToken;
    if (loanToken && (loanToken.decimals !== token.decimals || loanToken.symbol !== token.symbol)) {
      throw new Error("Borrowed assets do not share a loan token.");
    }
    loanToken = token;
    debt += amount;
    weightedApr += amount * BigInt(snapshot.state.borrowAprWad);
  }
  return {
    totalDebtRaw: debt.toString(),
    loanToken: loanToken ?? overview.opportunities[0]?.market.loanToken ?? null,
    aprWad: debt > BigInt(0) ? (weightedApr / debt).toString() : null,
    completeness: overview.discovery.verifiedCount === 0 ? "unavailable" as const
      : overview.discovery.status === "complete" && overview.opportunities.every((entry) => entry.availability.status === "available") ? "complete" as const : "partial" as const,
    openLoanCount: overview.opportunities.filter((entry) => entry.availability.status === "available" && BigInt(entry.availability.snapshot.position.debtAssetsRaw) > BigInt(0)).length,
  };
}

export type OpenLoan =
  | { kind: "available"; market: BorrowMarketSnapshot["market"]; snapshot: BorrowMarketSnapshot }
  | { kind: "unavailable"; market: BorrowOverviewResponse["positions"][number]["market"] };

export function openLoans(overview: BorrowOverviewResponse): OpenLoan[] {
  const rows: OpenLoan[] = overview.opportunities.flatMap((entry) => entry.availability.status === "available" &&
    (BigInt(entry.availability.snapshot.position.debtAssetsRaw) > BigInt(0) || BigInt(entry.availability.snapshot.position.collateralRaw) > BigInt(0))
    ? [{ kind: "available" as const, market: entry.market, snapshot: entry.availability.snapshot }] : []);
  for (const position of overview.positions) {
    if (overview.opportunities.some((entry) => entry.market.id === position.market.id && entry.availability.status === "available")) continue;
    rows.push({ kind: "unavailable", market: position.market });
  }
  const tier = (row: OpenLoan) => {
    if (row.kind === "unavailable") return 5;
    if (BigInt(row.snapshot.position.debtAssetsRaw) === BigInt(0)) return 4;
    return { liquidatable: 0, urgent: 1, "limited-buffer": 2, healthy: 3, "no-debt": 4 }[borrowRiskState(row.snapshot.position.healthFactorWad)];
  };
  return rows.sort((a, b) => tier(a) - tier(b) || (tier(a) < 4 && a.kind === "available" && b.kind === "available"
    ? BigInt(a.snapshot.position.healthFactorWad ?? "0") < BigInt(b.snapshot.position.healthFactorWad ?? "0") ? -1
      : BigInt(a.snapshot.position.healthFactorWad ?? "0") > BigInt(b.snapshot.position.healthFactorWad ?? "0") ? 1 : 0
    : 0) || a.market.rank - b.market.rank);
}

export type BorrowableAsset =
  | { kind: "held"; market: BorrowMarketSnapshot["market"]; snapshot: BorrowMarketSnapshot; openingAvailableRaw: string }
  | { kind: "held-no-capacity"; market: BorrowMarketSnapshot["market"]; snapshot: BorrowMarketSnapshot }
  | { kind: "not-held"; market: BorrowMarketSnapshot["market"]; snapshot: BorrowMarketSnapshot }
  | { kind: "unavailable"; market: BorrowOverviewResponse["opportunities"][number]["market"] };

export function borrowableAssets(overview: BorrowOverviewResponse): BorrowableAsset[] {
  const rows: BorrowableAsset[] = [];
  for (const entry of overview.opportunities) {
    if (entry.availability.status === "unavailable") {
      if (overview.positions.some((position) => position.market.id === entry.market.id)) continue;
      rows.push({ kind: "unavailable", market: entry.market });
      continue;
    }
    const snapshot = entry.availability.snapshot;
    if (BigInt(snapshot.position.debtAssetsRaw) > BigInt(0) || BigInt(snapshot.position.collateralRaw) > BigInt(0) ||
      snapshot.eligibility.mode !== "enabled" || !snapshot.eligibility.newRisk) continue;
    if (BigInt(snapshot.wallet.collateralBalanceRaw) === BigInt(0)) {
      rows.push({ kind: "not-held", market: entry.market, snapshot });
      continue;
    }
    const openingAvailableRaw = openingBorrowAvailableBaseUnits(snapshot);
    rows.push(BigInt(openingAvailableRaw) > BigInt(0)
      ? { kind: "held", market: entry.market, snapshot, openingAvailableRaw }
      : { kind: "held-no-capacity", market: entry.market, snapshot });
  }
  const tier = { held: 0, "held-no-capacity": 1, "not-held": 2, unavailable: 3 };
  return rows.sort((a, b) => tier[a.kind] - tier[b.kind] || a.market.rank - b.market.rank);
}

export function loanActions(snapshot: BorrowMarketSnapshot) {
  const hasDebt = BigInt(snapshot.position.debtAssetsRaw) > BigInt(0);
  const hasCollateral = BigInt(snapshot.position.collateralRaw) > BigInt(0);
  const hasWalletCollateral = BigInt(snapshot.wallet.collateralBalanceRaw) > BigInt(0);
  const hasWalletLoan = BigInt(snapshot.wallet.loanBalanceRaw) > BigInt(0);
  const risk = borrowRiskState(snapshot.position.healthFactorWad);
  const canNewRisk = snapshot.eligibility.newRisk && snapshot.eligibility.mode === "enabled" && risk !== "urgent" && risk !== "liquidatable";
  const canBorrow = canNewRisk && BigInt(snapshot.state.liquidityAssetsRaw) > BigInt(0) &&
    (hasCollateral ? BigInt(snapshot.position.borrowCapacityAssetsRaw) > BigInt(0) : hasWalletCollateral && BigInt(openingBorrowAvailableBaseUnits(snapshot)) > BigInt(0));
  return {
    repay: hasWalletLoan,
    borrowMore: hasDebt && canBorrow,
    addCollateral: hasWalletCollateral,
    withdraw: hasCollateral && !(hasDebt && !canNewRisk) && BigInt(snapshot.position.withdrawableCollateralRaw) > BigInt(0),
    borrowOpen: !hasDebt && canBorrow,
    reason: snapshot.eligibility.mode === "reducing-only" || !snapshot.eligibility.newRisk
      ? snapshot.eligibility.reason ?? "New borrowing is paused. You can still repay or add collateral."
      : risk === "urgent" || risk === "liquidatable" ? borrowRiskDescription(snapshot.position.healthFactorWad)
        : hasDebt && !hasWalletLoan ? "Add USDC to your wallet to repay." : null,
  };
}
