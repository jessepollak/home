import {
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import {
  condensedTransactionHash,
  transactionExplorerLink,
  type TransactionDetailRow,
  type TransactionDetails,
} from "@/components/transaction-explorer";
import type { OperationResult } from "@/shared/money-actions/types";
import type { ActionKind, MoneyActionAmount } from "@/shared/money-actions/types";
import type { RecentMoneyActionOperation } from "./recent-operations";

const VAULT_SHARE_SYMBOL = "vault shares";

export function labelForOperationStatus(
  status: OperationResult["status"],
): string {
  switch (status) {
    case "pending": return "Pending";
    case "submitted": return "Submitted";
    case "confirmed": return "Confirmed";
    case "rejected": return "Rejected";
    case "failed": return "Failed";
    case "unknown": return "Outcome unknown";
  }
}

export function labelForMoneyActionKind(kind: ActionKind): string {
  switch (kind) {
    case "send": return "Send";
    case "trade": return "Trade";
    case "savings-deposit": return "Deposit to Save";
    case "savings-withdraw": return "Withdraw from Save";
    case "supply-collateral": return "Add collateral";
    case "borrow": return "Borrow";
    case "repay": return "Repay";
    case "withdraw-collateral": return "Withdraw collateral";
  }
}

/** Underlying assets first; ERC-4626 vault shares follow as secondary detail. */
export function primaryOperationAmount(
  operation: RecentMoneyActionOperation,
): MoneyActionAmount | undefined {
  return orderedOperationAmounts(operation.action.amounts)[0];
}

export function presentOperationDetails(
  operation: RecentMoneyActionOperation,
): TransactionDetails {
  const rows: TransactionDetailRow[] = [
    { label: "Status", value: labelForOperationStatus(operation.status) },
    { label: "Type", value: labelForMoneyActionKind(operation.action.kind) },
  ];

  for (const amount of orderedOperationAmounts(operation.action.amounts)) {
    rows.push({
      label: amount.maximum
        ? "Up to"
        : amount.direction === "spend"
          ? "You spend"
          : "You receive",
      value: `${amount.estimated ? "Estimated " : ""}${formatPresentationTokenAmount(
        amount.amountBaseUnits,
        amount.decimals,
        amount.symbol,
        { cashCurrency: amount.symbol === "USDC" ? "USD" : null },
      )}`,
    });
  }

  rows.push(
    { label: "Network", value: "Base (8453)" },
    { label: "Updated", value: formatPresentationDate(operation.updatedAt, { style: "activity-short" }) },
  );

  if (operation.transactionHash) {
    rows.push({
      label: "Transaction",
      value: condensedTransactionHash(operation.transactionHash),
      title: operation.transactionHash,
    });
  }

  return {
    title: operation.action.title,
    rows,
    explorer: transactionExplorerLink(operation.transactionHash),
  };
}

function orderedOperationAmounts(
  amounts: readonly MoneyActionAmount[],
): MoneyActionAmount[] {
  return [
    ...amounts.filter((amount) => amount.symbol !== VAULT_SHARE_SYMBOL),
    ...amounts.filter((amount) => amount.symbol === VAULT_SHARE_SYMBOL),
  ];
}
