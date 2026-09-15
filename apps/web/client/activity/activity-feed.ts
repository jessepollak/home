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
  /** Teaser feeds never resolve the transfer cursor, so unmatched actions stay visible there. */
  teaser?: boolean;
}): ActivityFeedItem[] {
  const transactionHashes = new Set(
    input.transfers.map((transfer) => transfer.transactionHash.toLowerCase()),
  );
  const transferPagesRemain = input.nextCursor !== null;
  const actions = input.operations.filter((operation) => {
    // A loaded transaction hash is already on screen as its transfer row.
    if (operation.transactionHash && transactionHashes.has(operation.transactionHash.toLowerCase())) return false;
    // A hashless action can never collide with a later transfer page, so it cannot be shadowed.
    if (!operation.transactionHash) return true;
    // While transfer pages remain, an unmatched hashed action may still gain its
    // onchain twin, so page mode withholds it until the cursor is exhausted.
    // Timestamps are not consulted: block time and confirmation time are
    // different clocks and may share a block boundary. Teaser never exhausts
    // the cursor and shows the action instead of an empty feed.
    return !transferPagesRemain || input.teaser === true;
  });

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
