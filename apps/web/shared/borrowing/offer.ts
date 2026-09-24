import type { BorrowOverviewOpportunity } from "./contract";

export function leadingBorrowOffer(
  opportunities: readonly BorrowOverviewOpportunity[],
): BorrowOverviewOpportunity | null {
  return opportunities
    .filter((opportunity) =>
      opportunity.availability.status === "available" && opportunity.availability.mode === "enabled"
    )
    .sort((left, right) => left.market.rank - right.market.rank)[0] ?? null;
}
