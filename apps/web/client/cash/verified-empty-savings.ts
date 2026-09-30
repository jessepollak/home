import type { SavingsPortfolioSummary } from "@/client/savings/portfolio-summary";
import type { BalancesSnapshot } from "@/shared/balances/types";

export function verifiedEmptySavings({ balanceStatus, snapshot, balanceStale, vaultStatus, summary, shownCount }: {
  balanceStatus: "ready" | "loading" | "failed";
  snapshot: BalancesSnapshot | null;
  balanceStale: boolean;
  vaultStatus: "ready" | "loading" | "failed";
  summary: SavingsPortfolioSummary | null;
  shownCount: number;
}): boolean {
  return balanceStatus === "ready" && snapshot !== null && snapshot.stale !== true &&
    !balanceStale && snapshot.coverage.registry === "complete" && vaultStatus === "ready" &&
    summary?.balance.status === "available" && summary.funded === false && shownCount === 0;
}
