import {
  BORROW_HEALTH_BUFFER_WAD,
  BORROW_HEALTH_CRITICAL_WAD,
  BORROW_HEALTH_FLOOR_WAD,
  BORROW_LIQUIDATION_HEALTH_WAD,
} from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import {
  actionKindForBorrowOperation,
  type BorrowActionIntent,
  type BorrowOperation,
} from "@/shared/borrowing/types";
import type { ActionKind } from "@/shared/money-actions/types";

export type BorrowRiskState =
  | "healthy"
  | "limited-buffer"
  | "urgent"
  | "liquidatable"
  | "no-debt";

export function borrowRiskState(healthFactorWad: string | null): BorrowRiskState {
  if (healthFactorWad === null) return "no-debt";
  const health = BigInt(healthFactorWad);
  if (health < BORROW_LIQUIDATION_HEALTH_WAD) return "liquidatable";
  if (health < BORROW_HEALTH_FLOOR_WAD) return "urgent";
  if (health < BORROW_HEALTH_BUFFER_WAD) return "limited-buffer";
  return "healthy";
}

/** @public Borrow risk-label presenter exposed as a stable UI contract. */
export function borrowRiskCopy(state: BorrowRiskState): string {
  switch (state) {
    case "no-debt": return "No debt";
    case "healthy": return "Healthy buffer";
    case "limited-buffer": return "Limited buffer";
    case "urgent": return "Urgent — reduce risk";
    case "liquidatable": return "At liquidation risk";
  }
}

/** @public Borrow risk-description presenter exposed as a stable UI contract. */
export function borrowRiskDescription(healthFactorWad: string | null): string {
  if (healthFactorWad === null) return "No active liquidation threshold.";
  const health = BigInt(healthFactorWad);
  if (health < BORROW_LIQUIDATION_HEALTH_WAD) {
    return "At or below the indexed liquidation threshold. Repay or add collateral.";
  }
  if (health < BORROW_HEALTH_CRITICAL_WAD) {
    return "Very close to liquidation. Repay or add collateral now.";
  }
  if (health < BORROW_HEALTH_FLOOR_WAD) {
    return "Below Home’s new-risk floor. Borrowing and collateral withdrawal are unavailable.";
  }
  if (health < BORROW_HEALTH_BUFFER_WAD) {
    return "The position has a limited liquidation buffer.";
  }
  return "The position is above Home’s limited-buffer range.";
}

export type BorrowPreparedIntent = {
  kind: ActionKind;
  operation: BorrowOperation;
  params: BorrowActionIntent;
};

export function buildBorrowPreparedIntent({
  snapshot,
  operation,
  amountBaseUnits,
  collateralAmountBaseUnits,
  maximumRepayBaseUnits,
}: {
  snapshot: BorrowMarketSnapshot;
  operation: BorrowOperation;
  amountBaseUnits?: string;
  collateralAmountBaseUnits?: string;
  maximumRepayBaseUnits?: string;
}): BorrowPreparedIntent {
  if (operation === "close-position" && BigInt(snapshot.position.debtAssetsRaw) === BigInt(0)) {
    return {
      kind: actionKindForBorrowOperation("withdraw-collateral"),
      operation: "withdraw-collateral",
      params: {
        marketId: snapshot.market.id,
        operation: "withdraw-collateral",
        amountBaseUnits: snapshot.position.collateralRaw,
      },
    };
  }
  if (operation === "supply-and-borrow") {
    return {
      kind: actionKindForBorrowOperation(operation),
      operation,
      params: {
        marketId: snapshot.market.id,
        operation,
        amountBaseUnits: requiredAmount(amountBaseUnits),
        collateralAmountBaseUnits: requiredAmount(collateralAmountBaseUnits),
      },
    };
  }
  if (operation === "repay" && BigInt(requiredAmount(amountBaseUnits)) >= BigInt(snapshot.position.debtAssetsRaw)) {
    return {
      kind: actionKindForBorrowOperation("repay-all"),
      operation: "repay-all",
      params: {
        marketId: snapshot.market.id,
        operation: "repay-all",
        maximumRepayBaseUnits: requiredAmount(maximumRepayBaseUnits),
      },
    };
  }
  if (operation === "repay-all" || operation === "close-position") {
    return {
      kind: actionKindForBorrowOperation(operation),
      operation,
      params: {
        marketId: snapshot.market.id,
        operation,
        maximumRepayBaseUnits: requiredAmount(amountBaseUnits),
      },
    };
  }
  return {
    kind: actionKindForBorrowOperation(operation),
    operation,
    params: {
      marketId: snapshot.market.id,
      operation,
      amountBaseUnits: requiredAmount(amountBaseUnits),
    },
  };
}

function requiredAmount(value: string | undefined): string {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error("Enter a positive amount.");
  return value;
}
