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

  test("orders equal-time action ids by code unit rather than runtime locale collation", () => {
    const items = mergeActivityFeed({
      transfers: [],
      operations: [
        operation("alpha", "2026-09-15T12:00:00.000Z"),
        operation("Beta", "2026-09-15T12:00:00.000Z"),
      ],
    });

    expect(items.map(({ id }) => id)).toEqual(["Beta", "alpha"]);
  });

  test("keeps input order for equal-time actions that share an id", () => {
    const first = { ...operation("same-action", "2026-09-15T12:00:00.000Z"), status: "pending" as const };
    const second = { ...operation("same-action", "2026-09-15T12:00:00.000Z"), status: "confirmed" as const };

    const items = mergeActivityFeed({ transfers: [], operations: [first, second] });

    expect(items.map((item) => item.kind === "action" ? item.operation.status : null)).toEqual([
      "pending",
      "confirmed",
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
      operations: [],
    });

    expect(items.map(({ id }) => id)).toEqual([newerLog.id, olderLog.id]);
  });

  test("loaded matching hashes replace DB actions with canonical transfer rows", () => {
    const matchingTransfer = transfer("loaded-match", "2026-09-15T12:02:00.000Z", HASH_A);
    const secondMatchingTransfer = {
      ...transfer("loaded-match-second-log", "2026-09-15T12:02:00.000Z", HASH_A),
      logIndex: "0",
    };
    const items = mergeActivityFeed({
      transfers: [matchingTransfer, secondMatchingTransfer],
      operations: [
        operation("matched-action", "2026-09-15T12:03:00.000Z", HASH_A),
        operation("unmatched-action", "2026-09-15T12:01:00.000Z", HASH_C),
        operation("hashless-action", "2026-09-15T12:00:00.000Z"),
      ],
    });

    expect(items.filter(({ kind }) => kind === "transfer").map(({ id }) => id)).toEqual([
      matchingTransfer.id,
      secondMatchingTransfer.id,
    ]);
    expect(items.filter(({ kind }) => kind === "action").map(({ id }) => id)).toEqual([
      "unmatched-action",
      "hashless-action",
    ]);
  });

  test("keeps an unmatched hashed fallback until a later loaded page supplies its match", () => {
    const firstPage = [transfer("page-1", "2026-09-15T12:02:00.000Z", HASH_A)];
    const operations = [
      operation("unmatched-fallback", "2026-09-15T12:03:00.000Z", HASH_C),
      operation("hashless-fallback", "2026-09-15T12:01:00.000Z"),
    ];

    expect(mergeActivityFeed({ transfers: firstPage, operations })
      .filter(({ kind }) => kind === "action").map(({ id }) => id))
      .toEqual(["unmatched-fallback", "hashless-fallback"]);

    const laterPage = transfer("page-2-match", "2026-09-15T11:59:00.000Z", HASH_C);
    const afterLoadingMore = mergeActivityFeed({ transfers: [...firstPage, laterPage], operations });
    expect(afterLoadingMore.filter(({ kind }) => kind === "action").map(({ id }) => id))
      .toEqual(["hashless-fallback"]);
    expect(afterLoadingMore.some(({ kind, id }) => kind === "transfer" && id === laterPage.id)).toBe(true);
  });

  test("matches transaction hashes case-insensitively", () => {
    const items = mergeActivityFeed({
      transfers: [transfer("loaded", "2026-09-15T12:02:00.000Z", HASH_A)],
      operations: [operation("matched", "2026-09-15T12:03:00.000Z", HASH_A.toUpperCase() as `0x${string}`)],
    });

    expect(items.map(({ kind }) => kind)).toEqual(["transfer"]);
  });
});
