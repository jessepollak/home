import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
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
  nextCursor: string | null;
  operations: readonly RecentMoneyActionOperation[];
}): ActivityFeedItem[] {
  const transactionHashes = new Set(
    input.transfers.map((transfer) => transfer.transactionHash.toLowerCase()),
  );
  const frontier = input.nextCursor && input.transfers.length > 0
    ? Math.min(...input.transfers.map((transfer) => Date.parse(transfer.blockTimestamp)))
    : null;
  const frontierPending = input.nextCursor !== null && input.transfers.length === 0;
  const actions = input.operations.filter((operation) =>
    !frontierPending &&
    (!operation.transactionHash || !transactionHashes.has(operation.transactionHash.toLowerCase())) &&
    (frontier === null || Date.parse(operation.updatedAt) >= frontier),
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
  return left.id.localeCompare(right.id);
}
