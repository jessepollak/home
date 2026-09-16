import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityTransfer } from "@/shared/activity/types";
import { mergeActivityFeed } from "./activity-feed";

const HASH_A = `0x${"a".repeat(64)}` as const;
const HASH_B = `0x${"b".repeat(64)}` as const;
const HASH_C = `0x${"c".repeat(64)}` as const;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

function transfer(id: string, blockTimestamp: string, transactionHash = HASH_A): ActivityTransfer {
  return {
    id: `8453:${TOKEN}:${id}`,
    logId: id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: TOKEN,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    walletAddress: WALLET,
    fromAddress: OTHER,
    toAddress: WALLET,
    direction: "incoming",
    amountBaseUnits: "1",
    blockNumber: "1",
    blockHash: `0x${"c".repeat(64)}`,
    transactionHash,
    logIndex: "1",
    blockTimestamp,
  };
}

function operation(id: string, updatedAt: string, transactionHash?: `0x${string}`): RecentMoneyActionOperation {
  return {
    action: {
      id,
      kind: "send",
      title: id,
      amounts: [],
      warnings: [],
      expiresAt: updatedAt,
      createdAt: updatedAt,
    },
    status: "confirmed",
    createdAt: updatedAt,
    updatedAt,
    ...(transactionHash ? { transactionHash } : {}),
  };
}

describe("combined Activity feed", () => {
  test("interleaves both directions with deterministic equal-time ties", () => {
    const items = mergeActivityFeed({
      transfers: [
        transfer("new-transfer", "2026-09-15T12:03:00.000Z", HASH_A),
        transfer("same-transfer", "2026-09-15T12:01:00.000Z", HASH_B),
      ],
      nextCursor: null,
      operations: [
        operation("middle-action", "2026-09-15T12:02:00.000Z"),
        operation("same-action", "2026-09-15T12:01:00.000Z"),
        operation("old-action", "2026-09-15T12:00:00.000Z"),
      ],
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      `transfer:8453:${TOKEN}:new-transfer`,
      "action:middle-action",
      `transfer:8453:${TOKEN}:same-transfer`,
      "action:same-action",
      "action:old-action",
    ]);
  });

  test("preserves canonical order for same-transaction transfers", () => {
    const newerLog = {
      ...transfer(`${HASH_A}:9`, "2026-09-15T12:01:00.000Z", HASH_A),
      blockNumber: "2",
      logIndex: "9",
    };
    const olderLog = {
      ...transfer(`${HASH_A}:2`, "2026-09-15T12:01:00.000Z", HASH_A),
      blockNumber: "2",
      logIndex: "2",
    };

    const items = mergeActivityFeed({
      transfers: [newerLog, olderLog],
      nextCursor: null,
      operations: [],
    });

    expect(items.map(({ id }) => id)).toEqual([newerLog.id, olderLog.id]);
  });

  test("deduplicates loaded transaction hashes and withholds unmatched hashed actions while pages remain", () => {
    const transfers = [
      transfer("page-1", "2026-09-15T12:02:00.000Z", HASH_A),
      transfer("frontier", "2026-09-15T12:01:00.000Z", HASH_B),
    ];
    const operations = [
      operation("deduped", "2026-09-15T12:03:00.000Z", HASH_A),
      operation("hashless", "2026-09-15T12:01:30.000Z"),
      operation("unloaded-twin", "2026-09-15T11:59:00.000Z", HASH_C),
    ];

    // Page mode: loaded hashes dedupe, hashless actions cannot be shadowed and
    // remain, and an unmatched hashed action waits for its transfer page even
    // though it was confirmed after the oldest loaded block.
    expect(mergeActivityFeed({ transfers, nextCursor: "next", operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["hashless"]);
    // Once the cursor is exhausted, every unmatched action is shown.
    expect(mergeActivityFeed({ transfers, nextCursor: null, operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["hashless", "unloaded-twin"]);
    // A later page carrying the twin removes the action instead of duplicating it.
    expect(mergeActivityFeed({
      transfers: [...transfers, transfer("page-2-twin", "2026-09-15T11:58:00.000Z", HASH_C)],
      nextCursor: null,
      operations,
    }).filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["hashless"]);
  });

  test("shows a useful feed in teaser mode while the transfer cursor is unresolved", () => {
    const operations = [
      operation("hashless", "2026-09-15T12:01:30.000Z"),
      operation("unloaded-twin", "2026-09-15T11:59:00.000Z", HASH_C),
    ];

    // Sparse teaser: no transfers loaded yet and the teaser never mounts
    // pagination, so recorded actions are shown instead of a permanent empty state.
    expect(mergeActivityFeed({ transfers: [], nextCursor: "sparse-next", operations, teaser: true })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["hashless", "unloaded-twin"]);
    // Page mode stays conservative for hashed actions on the same sparse page.
    expect(mergeActivityFeed({ transfers: [], nextCursor: "sparse-next", operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["hashless"]);
  });

  test("still deduplicates loaded hashes in teaser mode", () => {
    const items = mergeActivityFeed({
      transfers: [transfer("page-1", "2026-09-15T12:02:00.000Z", HASH_A)],
      nextCursor: "next",
      operations: [
        operation("deduped", "2026-09-15T12:03:00.000Z", HASH_A),
        operation("hashless", "2026-09-15T12:01:30.000Z"),
        operation("unloaded-twin", "2026-09-15T11:59:00.000Z", HASH_C),
      ],
      teaser: true,
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      `transfer:8453:${TOKEN}:page-1`,
      "action:hashless",
      "action:unloaded-twin",
    ]);
  });

  test("does not infer cursor order from timestamps at a same-block boundary", () => {
    const transfers = [transfer("boundary", "2026-09-15T12:01:00.000Z", HASH_A)];
    const operations = [
      operation("same-block", "2026-09-15T12:01:00.000Z", HASH_B),
      operation("later-confirmation", "2026-09-15T12:05:00.000Z", HASH_C),
      operation("hashless-before-block", "2026-09-15T12:00:00.000Z"),
    ];

    // While pages remain, page mode withholds unmatched hashed actions even
    // when their confirmation time sits at or after the oldest loaded block
    // timestamp; a hashless action remains visible.
    expect(mergeActivityFeed({ transfers, nextCursor: "next", operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["hashless-before-block"]);
    // Exhausting the cursor reveals the withheld actions.
    expect(mergeActivityFeed({ transfers, nextCursor: null, operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id))
      .toEqual(["later-confirmation", "same-block", "hashless-before-block"]);
  });
});
