import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { compareActivityTransferKeys } from "@/shared/activity/contract";
import type { ActivityTransfer } from "@/shared/activity/types";

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
    };

export function mergeActivityFeed(input: {
  transfers: readonly ActivityTransfer[];
  operations: readonly RecentMoneyActionOperation[];
}): ActivityFeedItem[] {
  const transactionHashes = new Set(
    input.transfers.map((transfer) => transfer.transactionHash.toLowerCase()),
  );
  const actions = input.operations.filter(
    (operation) => !operation.transactionHash
      || !transactionHashes.has(operation.transactionHash.toLowerCase()),
  );

  return [
    ...input.transfers.map((transfer): ActivityFeedItem => ({
      kind: "transfer",
      id: transfer.id,
      timestamp: transfer.blockTimestamp,
      transfer,
    })),
    ...actions.map((operation): ActivityFeedItem => ({
      kind: "action",
      id: operation.action.id,
      timestamp: operation.updatedAt,
      operation,
    })),
  ].sort(compareActivityFeedItems);
}

function compareActivityFeedItems(left: ActivityFeedItem, right: ActivityFeedItem): number {
  const time = Date.parse(right.timestamp) - Date.parse(left.timestamp);
  if (time !== 0) return time;
  if (left.kind !== right.kind) return left.kind === "transfer" ? -1 : 1;
  if (left.kind === "transfer" && right.kind === "transfer") {
    return -compareActivityTransferKeys(left.transfer, right.transfer);
  }
  return compareActionIds(left.id, right.id);
}

// Code-unit order keeps same-timestamp ties deterministic across runtimes;
// locale-aware collation would depend on the host locale.
function compareActionIds(leftId: string, rightId: string): number {
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}
