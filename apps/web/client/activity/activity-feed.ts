import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { compareActivityTransferKeys } from "@/shared/activity/contract";
import { activityAssets, type ActivityTransfer } from "@/shared/activity/types";
import type { MoneyActionAmount } from "@/shared/money-actions/types";

export type ActivityFeedItem =
  | {
      kind: "transfer";
      id: string;
      timestamp: string;
      transfer: ActivityTransfer;
    }
  | {
      kind: "action";
      id: string;
      timestamp: string;
      operation: RecentMoneyActionOperation;
      transfers: readonly ActivityTransfer[];
    };

export function mergeActivityFeed(input: {
  transfers: readonly ActivityTransfer[];
  operations: readonly RecentMoneyActionOperation[];
  loadedThrough: string | null;
}): ActivityFeedItem[] {
  const loadedThroughTime = input.loadedThrough === null ? null : Date.parse(input.loadedThrough);
  const transfersByHash = new Map<string, ActivityTransfer[]>();
  for (const transfer of input.transfers) {
    const hash = transfer.transactionHash.toLowerCase();
    const matches = transfersByHash.get(hash) ?? [];
    matches.push(transfer);
    transfersByHash.set(hash, matches);
  }
  const actionIdsByHash = new Map<string, Set<string>>();
  for (const operation of input.operations) {
    if (!operation.transactionHash) continue;
    const hash = operation.transactionHash.toLowerCase();
    const ids = actionIdsByHash.get(hash) ?? new Set<string>();
    ids.add(operation.action.id);
    actionIdsByHash.set(hash, ids);
  }

  return [
    ...input.transfers.filter((transfer) => !actionIdsByHash.has(transfer.transactionHash.toLowerCase()))
      .map((transfer): ActivityFeedItem => ({
        kind: "transfer",
        id: transfer.id,
        timestamp: transfer.blockTimestamp,
        transfer,
      })),
    ...input.operations.flatMap((operation): ActivityFeedItem[] => {
      const hash = operation.transactionHash?.toLowerCase();
      const transfers = hash ? transfersByHash.get(hash) ?? [] : [];
      if (transfers.length === 0 && operation.status !== "pending" && loadedThroughTime !== null &&
        Date.parse(operation.updatedAt) <= loadedThroughTime) return [];
      const sharedHash = hash !== undefined && (actionIdsByHash.get(hash)?.size ?? 0) > 1;
      const settled = transfers.length > 0 ? settleOperation(operation, transfers, !sharedHash) : operation;
      return [{
        kind: "action",
        id: operation.action.id,
        timestamp: settled.updatedAt,
        operation: settled,
        transfers,
      }];
    }),
  ].sort((left, right) => compareActivityFeedItems(left, right, loadedThroughTime));
}

function settleOperation(
  operation: RecentMoneyActionOperation,
  transfers: readonly ActivityTransfer[],
  settleAmountsFromTransfers: boolean,
): RecentMoneyActionOperation {
  const updatedAt = transfers.reduce((latest, transfer) =>
    Date.parse(transfer.blockTimestamp) > Date.parse(latest) ? transfer.blockTimestamp : latest,
  transfers[0]!.blockTimestamp);
  return {
    ...operation,
    status: operation.status === "pending" || operation.status === "unknown" ? "confirmed" : operation.status,
    updatedAt,
    action: {
      ...operation.action,
      amounts: settleAmountsFromTransfers
        ? settleAmounts(operation.action.amounts, transfers)
        : [...operation.action.amounts],
    },
  };
}

function settleAmounts(amounts: readonly MoneyActionAmount[], transfers: readonly ActivityTransfer[]): MoneyActionAmount[] {
  const settledKeys = new Set<string>();
  return amounts.flatMap((amount) => {
    const settled = settleAmount(amount, transfers);
    if (settled === amount) return [amount];
    const key = `${settled.assetId.toLowerCase()}:${settled.direction}`;
    if (settledKeys.has(key)) return [];
    settledKeys.add(key);
    return [settled];
  });
}

function settleAmount(amount: MoneyActionAmount, transfers: readonly ActivityTransfer[]): MoneyActionAmount {
  const tokenAddress = amount.assetId.match(/erc20:(0x[0-9a-fA-F]{40})$/i)?.[1]
    ?? activityAssets.find((asset) => asset.id.toLowerCase() === amount.assetId.toLowerCase())?.tokenAddress;
  if (!tokenAddress) return amount;

  let matched = false;
  let sum = BigInt(0);
  for (const transfer of transfers) {
    if (transfer.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase() ||
      transfer.direction !== (amount.direction === "spend" ? "outgoing" : "incoming") ||
      (transfer.tokenDecimals !== null && transfer.tokenDecimals !== amount.decimals)) continue;
    matched = true;
    sum += BigInt(transfer.amountBaseUnits);
  }
  if (!matched) return amount;
  const settled = { ...amount, amountBaseUnits: sum.toString() };
  delete settled.estimated;
  delete settled.maximum;
  return settled;
}

function compareActivityFeedItems(left: ActivityFeedItem, right: ActivityFeedItem, loadedThroughTime: number | null): number {
  if (loadedThroughTime !== null) {
    const leftLeads = left.kind === "action" && left.transfers.length === 0 && left.operation.status === "pending" &&
      Date.parse(left.timestamp) < loadedThroughTime;
    const rightLeads = right.kind === "action" && right.transfers.length === 0 && right.operation.status === "pending" &&
      Date.parse(right.timestamp) < loadedThroughTime;
    if (leftLeads !== rightLeads) return leftLeads ? -1 : 1;
  }
  const time = Date.parse(right.timestamp) - Date.parse(left.timestamp);
  if (time !== 0) return time;
  if (left.kind !== right.kind) return left.kind === "transfer" ? -1 : 1;
  if (left.kind === "transfer" && right.kind === "transfer") {
    return -compareActivityTransferKeys(left.transfer, right.transfer);
  }
  return compareActionIds(left.id, right.id);
}

function compareActionIds(leftId: string, rightId: string): number {
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}
