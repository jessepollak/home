import { formatAddress } from "@/shared/formatting";
import { formatBaseUnitAmount } from "@/client/portfolio/format";
import {
  condensedTransactionHash,
  transactionExplorerLink,
  type TransactionDetailRow,
  type TransactionDetails,
} from "@/components/transaction-explorer";
import { transferRequestFromAction } from "@/shared/transfers/transfer-helpers";
import type { RecentMoneyActionOperation } from "./recent-operations";
import type {
  MoneyActionAmount,
  MoneyActionKind,
  MoneyActionOperationStatus,
} from "@/shared/money-actions/types";

const VAULT_SHARE_SYMBOL = "vault shares";

export function labelForOperationStatus(
  status: MoneyActionOperationStatus,
): string {
  switch (status) {
    case "prepared": return "Ready for review";
    case "submitting": return "Wallet submission unresolved";
    case "submitted": return "Submitted";
    case "included": return "Included";
    case "confirmed": return "Confirmed";
    case "rejected": return "Rejected";
    case "expired": return "Expired";
    case "failed": return "Failed";
    case "unknown": return "Outcome unknown";
  }
}

export function labelForMoneyActionKind(kind: MoneyActionKind): string {
  switch (kind) {
    case "send": return "Send";
    case "swap": return "Swap";
    case "save-deposit": return "Deposit to Save";
    case "save-withdraw": return "Withdraw from Save";
    case "supply-collateral": return "Supply collateral";
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
      value: `${amount.estimated ? "Estimated " : ""}${formatBaseUnitAmount(
        amount.amountBaseUnits,
        amount.decimals,
      )} ${amount.symbol}`,
    });
  }

  const sendRequest = transferRequestFromAction(operation.action);
  if (sendRequest) {
    rows.push({
      label: "To",
      value: formatAddress(sendRequest.recipient),
      title: sendRequest.recipient,
    });
  } else {
    operation.action.calls.forEach((call, index) => {
      rows.push({
        label: operation.action.calls.length === 1
          ? "Target"
          : `Target ${index + 1}`,
        value: formatAddress(call.to),
        title: call.to,
      });
    });
  }

  rows.push(
    { label: "Network", value: "Base (8453)" },
    { label: "Updated", value: formatOperationDate(operation.updatedAt) },
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

function formatOperationDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
