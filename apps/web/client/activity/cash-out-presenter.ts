import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { RegionId } from "@/config/regions";
import { formatFiatAmount, formatPresentationDate } from "@/shared/formatting";
import { baseNetworkRow, condensedTransactionHash, transactionExplorerLink, type TransactionDetails, type TransactionStatusTone } from "@/components/transaction-explorer";
import { labelForOperationStatus, presentOperationDetails } from "@/client/actions/operation-details";

export type CashoutStage = "failed" | "returning" | "returned" | "paid" | "paying" | "waiting" | "checking";

export function cashoutMoney(atoms: string, decimals = 6, regionId?: RegionId): string {
  const amount = BigInt(atoms);
  return formatFiatAmount(amount, decimals, "USD", {
    regionId,
    fractionDigits: Math.max(2, decimals),
    minimumFractionDigits: amount % (BigInt(10) ** BigInt(decimals)) === BigInt(0) ? 0 : 2,
  });
}

const withdrawRank: Record<RecentMoneyActionOperation["status"], number> = { pending: 1, unknown: 1, confirmed: 2, failed: 0 };

export function outranksCashoutWithdraw(
  candidate: Pick<RecentMoneyActionOperation, "status">,
  current: Pick<RecentMoneyActionOperation, "status"> | undefined,
  candidateIsNewer: boolean,
) {
  if (!current) return true;
  const difference = withdrawRank[candidate.status] - withdrawRank[current.status];
  return difference > 0 || difference === 0 && candidateIsNewer;
}

export function linkedCashoutWithdraw(operation: RecentMoneyActionOperation, operations: readonly RecentMoneyActionOperation[]): RecentMoneyActionOperation | undefined {
  const depositId = operation.cashout?.depositId?.toLowerCase();
  if (!depositId) return undefined;
  let selected: RecentMoneyActionOperation | undefined;
  for (const candidate of operations) {
    const metadata = candidate.action.metadata;
    if (candidate.action.kind !== "cash-out-withdraw" || metadata?.product !== "cashout" || metadata.operation !== "withdraw" ||
      metadata.depositId.toLowerCase() !== depositId) continue;
    if (outranksCashoutWithdraw(candidate, selected, !selected || candidate.updatedAt > selected.updatedAt)) selected = candidate;
  }
  return selected;
}

export function presentCashout(
  operation: RecentMoneyActionOperation,
  withdraw?: RecentMoneyActionOperation,
  options: { regionId?: RegionId } = {},
) {
  const money = (atoms: string, decimals: number) => cashoutMoney(atoms, decimals, options.regionId);
  const progress = operation.cashout;
  const metadata = operation.action.metadata?.product === "cashout" && operation.action.metadata.operation === "deposit"
    ? operation.action.metadata : null;
  const spend = operation.action.amounts.find((amount) => amount.direction === "spend");
  const decimals = spend?.decimals ?? 6;
  const total = progress?.amountAtomic ?? spend?.amountBaseUnits ?? "0";
  const paid = progress?.filledAtomic ?? "0";
  const remaining = progress?.remainingAtomic ?? total;
  const returned = progress?.returnedAtomic ?? "0";
  const verifiedReturn = BigInt(returned) > BigInt(0) && BigInt(paid) + BigInt(returned) >= BigInt(total);
  const app = progress?.platformLabel ?? metadata?.platformLabel ?? "payout app";
  if (operation.action.metadata?.product === "cashout" && operation.action.metadata.operation === "withdraw") {
    return {
      stage: "returned" as CashoutStage,
      label: operation.action.title,
      status: labelForOperationStatus(operation.status),
      app, total, paid, returned, remaining, decimals,
      inProgress: false, refreshing: false, cancellable: false, metadata,
    };
  }
  const withdrawUnsettled = progress?.withdrawing === true;
  const unlinkedFailure = operation.status === "failed" && !progress?.depositId && (!progress || progress.settledAt !== null);
  const stage: CashoutStage = progress?.state === "failed" || unlinkedFailure ? "failed"
    : progress?.state === "returned" || verifiedReturn && progress?.state === "delivered" ? "returned"
      : progress?.state === "delivered" ? "paid"
        : withdrawUnsettled ? "returning"
          : verifiedReturn && withdraw?.status === "confirmed" ? "returned"
            : withdraw?.status === "confirmed" ? "returning"
              : progress?.state === "matched" || progress?.state === "delivering" ? "paying"
                : progress?.state === "unknown" || !progress?.depositId && (operation.status === "unknown" || operation.status === "failed") ? "checking"
                  : "waiting";
  const label = `${money(total, decimals)} to ${app}`;
  const status = stage === "failed" ? "Cash-out failed"
    : stage === "returning" ? "Returning"
      : stage === "returned" ? BigInt(paid) === BigInt(0) ? "Returned" : `Paid ${money(paid, decimals)} to ${app} · ${money(returned, decimals)} returned`
        : stage === "paid" ? `Paid to ${app}`
          : stage === "paying" ? BigInt(paid) === BigInt(0) ? "Buyer paying you" : `${money(paid, decimals)} paid · Buyer paying you`
            : stage === "waiting" ? BigInt(paid) === BigInt(0) ? "Waiting for a buyer" : `${money(paid, decimals)} paid · ${money(remaining, decimals)} waiting for a buyer`
              : "Checking status";
  const inProgress = stage === "waiting" || stage === "paying" || stage === "returning" || stage === "checking";
  const refreshing = inProgress || progress?.settledAt === null && stage !== "failed";
  const cancellable = stage === "waiting" && progress?.withdrawable === true && Boolean(progress.depositId) && BigInt(remaining) > BigInt(0) && !withdrawUnsettled;
  return { stage, label, status, app, total, paid, returned, remaining, decimals, inProgress, refreshing, cancellable, metadata };
}

const stageTone: Record<CashoutStage, TransactionStatusTone> = {
  failed: "failure", returned: "success", paid: "success", returning: "pending", paying: "pending", waiting: "pending", checking: "neutral",
};

export function presentCashoutDetails(
  operation: RecentMoneyActionOperation,
  withdraw?: RecentMoneyActionOperation,
  options: { regionId?: RegionId } = {},
): TransactionDetails {
  if (operation.action.metadata?.product === "cashout" && operation.action.metadata.operation === "withdraw") return presentOperationDetails(operation, options);
  const view = presentCashout(operation, withdraw, options);
  const eta = operation.cashout?.etaSeconds ?? view.metadata?.etaSeconds;
  const rows: TransactionDetails["rows"] = [{ label: "Status", value: view.status, statusTone: stageTone[view.stage] }];
  if ((view.stage === "waiting" || view.stage === "paying") && eta !== null && eta !== undefined) {
    rows.push({ label: "Estimated delivery", value: `About ${Math.ceil(eta / 60)} min` });
  }
  if (view.metadata) {
    rows.push(
      { label: "Approximate receive", value: `≈ ${view.metadata.approximateFiatAmount} ${view.metadata.currency}` },
      { label: "Payout app", value: view.app },
      { label: "Payout handle", value: view.metadata.canonicalHandle },
    );
  } else {
    rows.push({ label: "Payout app", value: view.app });
  }
  if (BigInt(view.paid) > BigInt(0) && BigInt(view.paid) < BigInt(view.total)) {
    rows.push({ label: "Paid", value: cashoutMoney(view.paid, view.decimals, options.regionId) });
  }
  if (BigInt(view.returned) > BigInt(0)) rows.push({ label: "Returned", value: cashoutMoney(view.returned, view.decimals, options.regionId) });
  rows.push(
    baseNetworkRow(),
    { label: "Updated", value: formatPresentationDate(operation.cashout?.updatedAt ?? operation.updatedAt, { style: "activity-short", regionId: options.regionId }) },
  );
  if (operation.transactionHash) {
    rows.push({ label: "Transaction", value: operation.transactionHash, display: condensedTransactionHash(operation.transactionHash) });
  }
  return { title: view.label, rows, explorer: transactionExplorerLink(operation.transactionHash) };
}
