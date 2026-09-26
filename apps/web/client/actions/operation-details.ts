import {
  formatPresentationDate,
  formatExactPresentationTokenAmount,
} from "@/shared/formatting";
import {
  baseNetworkRow,
  condensedTransactionHash,
  transactionExplorerLink,
  type TransactionDetailRow,
  type TransactionDetails,
  type TransactionStatusTone,
} from "@/components/transaction-explorer";
import type { OperationResult } from "@/shared/money-actions/types";
import type { ActionKind, MoneyActionAmount } from "@/shared/money-actions/types";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { RegionId } from "@/config/regions";

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

export function toneForOperationStatus(status: OperationResult["status"]): TransactionStatusTone {
  switch (status) {
    case "confirmed": return "success";
    case "pending":
    case "submitted": return "pending";
    case "failed": return "failure";
    case "rejected":
    case "unknown": return "neutral";
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

export function titleForOperation(operation: RecentMoneyActionOperation): string {
  const metadata = operation.action.metadata;
  if (operation.action.kind !== "trade" || metadata?.product !== "trade") return operation.action.title;
  switch (operation.status) {
    case "confirmed": return metadata.direction === "buy" ? "Bought Bitcoin" : "Sold Bitcoin";
    case "pending": return metadata.direction === "buy" ? "Buying Bitcoin" : "Selling Bitcoin";
    case "failed": return metadata.direction === "buy" ? "Buy Bitcoin failed" : "Sell Bitcoin failed";
    case "unknown": return metadata.direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin";
  }
}

export function primaryOperationAmount(
  operation: RecentMoneyActionOperation,
): MoneyActionAmount | undefined {
  return orderedOperationAmounts(operation.action.amounts)[0];
}

export function presentOperationDetails(
  operation: RecentMoneyActionOperation,
  options: { regionId?: RegionId; timeZone?: string } = {},
): TransactionDetails {
  const rows: TransactionDetailRow[] = [
    { label: "Status", value: labelForOperationStatus(operation.status), statusTone: toneForOperationStatus(operation.status) },
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
      label: operation.action.metadata?.product === "trade"
        ? amount.direction === "spend" ? "You pay" : "You receive"
        : amount.maximum
          ? "Up to"
          : amount.direction === "spend"
            ? "You spend"
            : "You receive",
      value: `${amount.estimated ? "Estimated " : ""}${formatExactPresentationTokenAmount(
        amount.amountBaseUnits,
        amount.decimals,
        amount.symbol,
        { regionId: options.regionId },
      )}`,
    });
  }

  rows.push(
    baseNetworkRow(),
    { label: "Updated", value: formatPresentationDate(operation.updatedAt, {
      style: "activity-short",
      regionId: options.regionId,
      timeZone: options.timeZone,
    }) },
  );

  if (operation.transactionHash) {
    rows.push({
      label: "Transaction",
      value: operation.transactionHash,
      display: condensedTransactionHash(operation.transactionHash),
    });
  }

  return {
    title: titleForOperation(operation),
    rows,
    ...(operation.status === "pending" && (operation.submittedAt || operation.transactionHash || operation.userOperationHash) ? { steps: [
      {
        status: "complete" as const,
        title: "Submitted",
        ...(operation.submittedAt && Number.isFinite(Date.parse(operation.submittedAt)) ? { time: formatPresentationDate(operation.submittedAt, {
          style: "activity-short",
          regionId: options.regionId,
          timeZone: options.timeZone,
        }) } : {}),
      },
      { status: "current" as const, title: "Confirming on Base" },
    ] } : {}),
    explorer: transactionExplorerLink(operation.transactionHash),
  };
}

function labelForStoredOperation(operation: RecentMoneyActionOperation): string {
  const metadata = operation.action.metadata;
  if (operation.action.kind === "trade" && metadata?.product === "trade") {
    return metadata.direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin";
  }
  const borrow = metadata?.product === "borrow" ? metadata.operation : null;
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
