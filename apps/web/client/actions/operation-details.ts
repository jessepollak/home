import {
  formatPresentationDate,
  formatExactPresentationTokenAmount,
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
    case "cash-out": return "Cash out";
    case "cash-out-withdraw": return "Withdraw cash-out";
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
    { label: "Type", value: labelForStoredOperation(operation) },
  ];
  if (operation.action.metadata?.product === "borrow") {
    rows.push({
      label: "Market",
      value: `${operation.action.metadata.collateralAsset.symbol} / ${operation.action.metadata.loanAsset.symbol}`,
    });
  } else if (operation.action.metadata?.product === "cashout") {
    rows.push(
      { label: "Provider", value: operation.action.metadata.providerName },
      { label: "Payout app", value: operation.action.metadata.platformLabel },
      ...(operation.action.metadata.operation === "deposit" ? [
        { label: "Payout handle", value: operation.action.metadata.canonicalHandle },
        { label: "Approximate receive", value: `≈ ${operation.action.metadata.approximateFiatAmount} ${operation.action.metadata.currency}` },
        ...(operation.action.metadata.etaSeconds === undefined ? [] : [{ label: "Estimated delivery", value: operation.action.metadata.etaSeconds === null ? "Unavailable" : `${Math.ceil(operation.action.metadata.etaSeconds / 60)} min (historical)` }]),
      ] : []),
    );
  }

  for (const amount of orderedOperationAmounts(operation.action.amounts)) {
    rows.push({
      label: amount.maximum
        ? "Up to"
        : amount.direction === "spend"
          ? "You spend"
          : "You receive",
      value: `${amount.estimated ? "Estimated " : ""}${formatExactPresentationTokenAmount(
        amount.amountBaseUnits,
        amount.decimals,
        amount.symbol,
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
      value: operation.transactionHash,
      display: condensedTransactionHash(operation.transactionHash),
    });
  }

  return {
    title: operation.action.title,
    rows,
    explorer: transactionExplorerLink(operation.transactionHash),
  };
}

function labelForStoredOperation(operation: RecentMoneyActionOperation): string {
  const borrow = operation.action.metadata?.product === "borrow" ? operation.action.metadata.operation : null;
  switch (borrow) {
    case "supply-collateral": return "Add collateral";
    case "borrow": return "Borrow";
    case "supply-and-borrow": return "Supply and borrow";
    case "repay": return "Repay";
    case "repay-all": return "Repay all";
    case "withdraw-collateral": return "Withdraw collateral";
    case "close-position": return "Close position";
    default: return labelForMoneyActionKind(operation.action.kind);
  }
}

function orderedOperationAmounts(
  amounts: readonly MoneyActionAmount[],
): MoneyActionAmount[] {
  return [
    ...amounts.filter((amount) => amount.symbol !== VAULT_SHARE_SYMBOL),
    ...amounts.filter((amount) => amount.symbol === VAULT_SHARE_SYMBOL),
  ];
}
