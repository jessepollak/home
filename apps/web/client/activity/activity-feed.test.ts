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

  test("deduplicates loaded transaction hashes and withholds actions behind the loaded frontier", () => {
    const transfers = [
      transfer("page-1", "2026-09-15T12:02:00.000Z", HASH_A),
      transfer("frontier", "2026-09-15T12:01:00.000Z", HASH_B),
    ];
    const operations = [
      operation("deduped", "2026-09-15T12:03:00.000Z", HASH_A),
      operation("visible", "2026-09-15T12:01:30.000Z"),
      operation("withheld", "2026-09-15T12:00:00.000Z"),
      operation("late-twin", "2026-09-15T11:59:00.000Z", HASH_C),
    ];

    expect(mergeActivityFeed({ transfers, nextCursor: "next", operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["visible"]);
    expect(mergeActivityFeed({ transfers, nextCursor: null, operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["visible", "withheld", "late-twin"]);
    expect(mergeActivityFeed({ transfers: [], nextCursor: "sparse-next", operations })).toEqual([]);
    expect(mergeActivityFeed({
      transfers: [...transfers, transfer("page-2-twin", "2026-09-15T11:58:00.000Z", HASH_C)],
      nextCursor: null,
      operations,
    }).filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual(["visible", "withheld"]);
  });
});
