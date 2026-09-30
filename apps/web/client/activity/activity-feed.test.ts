import { parseHash32 } from "@/shared/chain/hex";
import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityCashoutOrder } from "@/shared/activity/contract-orders";
import type { ActivityTransfer } from "@/shared/activity/types";
import { mergeActivityFeed } from "./activity-feed";
import { presentActivityLedgerItems } from "./activity-ledger-items";

const HASH_A = parseHash32(`0x${"a".repeat(64)}`)!;
const HASH_B = parseHash32(`0x${"b".repeat(64)}`)!;
const HASH_C = parseHash32(`0x${"c".repeat(64)}`)!;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const VAULT = "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61" as const;

function transfer(id: string, blockTimestamp: string, transactionHash: `0x${string}` = HASH_A): ActivityTransfer {
  return {
    id: `8453:${TOKEN}:${id}`,
    logId: id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: TOKEN,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    tokenImageUrl: null,
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
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
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
    ...(transactionHash ? { transactionHash: parseHash32(transactionHash)! } : {}),
  };
}

function paidCashout(providerUpdatedAt: string, transactionHash?: `0x${string}`): RecentMoneyActionOperation {
  const base = operation("paid-cashout", "2026-09-15T12:00:00.000Z", transactionHash);
  return {
    ...base,
    action: { ...base.action, kind: "cash-out" },
    cashout: {
      version: 1, providerId: "peer", region: "US", depositId: "escrow", state: "delivered",
      platform: "cashapp", platformLabel: "Cash App", amountAtomic: "1000000", filledAtomic: "1000000",
      returnedAtomic: "0", remainingAtomic: "0", withdrawable: false, withdrawing: false,
      etaSeconds: null, settledAt: providerUpdatedAt, updatedAt: providerUpdatedAt,
    },
  };
}

const cashoutOrder: ActivityCashoutOrder = {
  kind: "cash-out", id: "quoted-cashout", orderId: "deposit-1", region: "US", providerId: "peer", providerName: "Peer",
  platform: "cashapp", platformLabel: "Cash App", status: "waiting-provider", state: "awaiting-buyer",
  decimals: 6, amountAtomic: "50000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000",
  withdrawable: true, settledAt: null, createdAt: "2026-09-15T12:00:00.000Z", updatedAt: "2026-09-15T12:02:00.000Z",
};
const quotedCashout: RecentMoneyActionOperation = {
  ...operation(cashoutOrder.id, cashoutOrder.createdAt),
  action: {
    ...operation(cashoutOrder.id, cashoutOrder.createdAt).action, kind: "cash-out",
    metadata: {
      product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice",
      approximateFiatAmount: "50.00", minConversionRate: "1", intentAmountRange: { min: "50000000", max: "50000000" },
      estimateAsOf: cashoutOrder.createdAt, escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
      quote: {
        fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null }, rate: null,
        receive: { amount: "50.00", currency: "USD", approximate: true },
        arrival: { source: "declared", kind: "within", seconds: 600 },
      },
    },
  },
};

describe("combined Activity feed", () => {
  test("keeps reviewed receive and arrival facts when the newer order wins", () => {
    const feed = mergeActivityFeed({ transfers: [], operations: [quotedCashout], orders: [cashoutOrder], loadedThrough: null });
    expect(feed.map(({ kind, id }) => [kind, id])).toEqual([["order", cashoutOrder.id]]);
    expect(feed[0]?.kind === "order" && feed[0].reviewed).toBe(quotedCashout);
    const [item] = presentActivityLedgerItems(feed, { regionId: "US", timeZone: "UTC" });
    expect(item).toMatchObject({ family: "cash-out-order", status: "waiting-provider" });
    expect(item?.detail).toMatchObject({ facts: [
      { label: "You receive", value: "≈ $50.00 to Cash App" },
      { label: "Arrives", value: "Usually within 10 minutes" },
    ] });
  });

  test("leaves order-only cash-outs without reviewed quote facts", () => {
    const feed = mergeActivityFeed({ transfers: [], operations: [], orders: [cashoutOrder], loadedThrough: null });
    const [item] = presentActivityLedgerItems(feed, { regionId: "US", timeZone: "UTC" });
    expect(item?.detail.family === "cash-out-order" && item.detail.facts).toBeUndefined();
  });

  test.each([
    { status: "waiting-chain" as const, state: "returned" as const },
    { status: "refunded" as const, state: "returned" as const },
    { status: "confirmed" as const, state: "delivered" as const },
  ])("keeps the quote but omits arrival for $status orders", ({ status, state }) => {
    const order = { ...cashoutOrder, status, state };
    const feed = mergeActivityFeed({ transfers: [], operations: [quotedCashout], orders: [order], loadedThrough: null });
    const [item] = presentActivityLedgerItems(feed, { regionId: "US", timeZone: "UTC" });
    expect(item).toMatchObject({ family: "cash-out-order", status });
    expect(item?.detail.family === "cash-out-order" && item.detail.facts).toContainEqual(
      { label: "You receive", value: "≈ $50.00 to Cash App" },
    );
    expect(item?.detail.family === "cash-out-order" && item.detail.facts?.some(({ label }) => label === "Arrives")).toBe(false);
  });

  test("omits arrival when a linked withdrawal is returning the order", () => {
    const withdrawal: RecentMoneyActionOperation = {
      ...operation("withdraw", cashoutOrder.createdAt), status: "pending",
      action: { ...operation("withdraw", cashoutOrder.createdAt).action, kind: "cash-out-withdraw",
        metadata: {
          product: "cashout", operation: "withdraw", depositId: cashoutOrder.orderId!,
          providerId: "peer", providerName: "Peer", environment: "production", platform: "cashapp", platformLabel: "Cash App",
          currency: "USD", approximateFiatAmount: "50", minConversionRate: "1",
          intentAmountRange: { min: "50000000", max: "50000000" }, estimateAsOf: cashoutOrder.createdAt,
          escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
        } },
    };
    const feed = mergeActivityFeed({ transfers: [], operations: [quotedCashout, withdrawal], orders: [cashoutOrder], loadedThrough: null });
    const [item] = presentActivityLedgerItems(feed, { regionId: "US", timeZone: "UTC" });
    expect(item).toMatchObject({ family: "cash-out-order", status: "waiting-chain" });
    expect(item?.detail.family === "cash-out-order" && item.detail.facts).toContainEqual(
      { label: "You receive", value: "≈ $50.00 to Cash App" },
    );
    expect(item?.detail.family === "cash-out-order" && item.detail.facts?.some(({ label }) => label === "Arrives")).toBe(false);
  });

  test("keeps a paid cash-out visible while its provider update is newer than the loaded boundary", () => {
    const providerUpdatedAt = "2026-09-15T12:04:00.000Z";
    const items = mergeActivityFeed({
      transfers: [], operations: [paidCashout(providerUpdatedAt)], loadedThrough: "2026-09-15T12:02:00.000Z",
    });

    expect(items.map(({ id }) => id)).toEqual(["paid-cashout"]);
    expect(items[0]?.timestamp).toBe(providerUpdatedAt);
  });

  test("sorts a settled cash-out by its displayed provider update rather than its transfer time", () => {
    const providerUpdatedAt = "2026-09-15T12:04:00.000Z";
    const matched = transfer("cashout", "2026-09-15T12:01:00.000Z", HASH_A);
    const between = transfer("between", "2026-09-15T12:02:00.000Z", HASH_B);
    const items = mergeActivityFeed({
      transfers: [matched, between], operations: [paidCashout(providerUpdatedAt, HASH_A)], loadedThrough: null,
    });
    const displayed = presentActivityLedgerItems(items, { regionId: "US", timeZone: "UTC" });

    expect(items.map(({ id }) => id)).toEqual(["paid-cashout", between.id]);
    expect(items[0]?.timestamp).toBe(providerUpdatedAt);
    expect(displayed[0]?.updatedAt).toBe(providerUpdatedAt);
    expect(displayed[0]?.timestamp).toBe(items[0]?.timestamp);
  });

  test("falls back to the operation time when a cash-out provider update is unparseable", () => {
    const cashout = paidCashout("not-a-date");
    const items = mergeActivityFeed({ transfers: [], operations: [cashout], loadedThrough: null });
    const displayed = presentActivityLedgerItems(items, { regionId: "US", timeZone: "UTC" });
    const deferred = mergeActivityFeed({ transfers: [], operations: [cashout], loadedThrough: cashout.updatedAt });

    expect(items[0]?.timestamp).toBe(cashout.updatedAt);
    expect(displayed[0]?.updatedAt).toBe(cashout.updatedAt);
    expect(deferred).toEqual([]);
  });

  test("defers an old confirmed action until transfer pages pass it or finish", () => {
    const recent = transfer("recent", "2026-09-15T12:04:00.000Z");
    const older = transfer("older", "2026-09-15T12:00:00.000Z", HASH_B);
    const settled = operation("settled", "2026-09-15T12:01:00.000Z");
    const first = mergeActivityFeed({
      transfers: [recent], operations: [settled], loadedThrough: "2026-09-15T12:03:00.000Z",
    });
    const later = mergeActivityFeed({
      transfers: [recent, older], operations: [settled], loadedThrough: "2026-09-15T12:00:00.000Z",
    });
    const complete = mergeActivityFeed({ transfers: [recent], operations: [settled], loadedThrough: null });

    expect(first.map(({ id }) => id)).toEqual([recent.id]);
    expect(later.map(({ id }) => id)).toEqual([recent.id, "settled", older.id]);
    expect(complete.map(({ id }) => id)).toEqual([recent.id, "settled"]);
  });

  test("defers equal-time settled actions while showing more recent ones", () => {
    const atBoundary = "2026-09-15T12:02:00.000Z";
    const items = mergeActivityFeed({
      transfers: [transfer("boundary", atBoundary)],
      operations: [
        operation("newer", "2026-09-15T12:03:00.000Z"),
        operation("equal", atBoundary),
      ],
      loadedThrough: atBoundary,
    });

    expect(items.map(({ id }) => id)).toEqual(["newer", `8453:${TOKEN}:boundary`]);
  });

  test("old unmatched pending actions lead newest-first and recent pending actions remain chronological", () => {
    const items = mergeActivityFeed({
      transfers: [transfer("newest", "2026-09-15T12:05:00.000Z")],
      operations: [
        { ...operation("oldest-pending", "2026-09-15T11:58:00.000Z"), status: "pending" },
        { ...operation("older-pending", "2026-09-15T11:59:00.000Z"), status: "pending" },
        { ...operation("recent-pending", "2026-09-15T12:03:00.000Z"), status: "pending" },
        { ...operation("boundary-pending", "2026-09-15T12:02:00.000Z"), status: "pending" },
      ],
      loadedThrough: "2026-09-15T12:02:00.000Z",
    });

    expect(items.map(({ id }) => id)).toEqual([
      "older-pending", "oldest-pending", `8453:${TOKEN}:newest`, "recent-pending", "boundary-pending",
    ]);
  });

  test("shows a matched action and hides its transfer even when updatedAt precedes the loaded boundary", () => {
    const indexed = transfer("matched", "2026-09-15T12:04:00.000Z");
    const items = mergeActivityFeed({
      transfers: [indexed],
      operations: [operation("matched-action", "2026-09-15T11:59:00.000Z", HASH_A)],
      loadedThrough: "2026-09-15T12:03:00.000Z",
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["action:matched-action"]);
    expect(items[0]?.kind === "action" && items[0].timestamp).toBe(indexed.blockTimestamp);
    expect(items[0]?.kind === "action" && items[0].transfers).toEqual([indexed]);
  });

  test("defers old failed and unknown actions without matched transfers", () => {
    const actions = [
      { ...operation("failed", "2026-09-15T12:00:00.000Z"), status: "failed" as const },
      { ...operation("unknown", "2026-09-15T12:01:00.000Z"), status: "unknown" as const },
    ];
    const first = mergeActivityFeed({ transfers: [], operations: actions, loadedThrough: "2026-09-15T12:02:00.000Z" });
    const complete = mergeActivityFeed({ transfers: [], operations: actions, loadedThrough: null });

    expect(first).toEqual([]);
    expect(complete.map(({ id }) => id)).toEqual(["unknown", "failed"]);
  });

  test("appending older transfer pages preserves existing item ids as an exact prefix", () => {
    const newest = transfer("newest", "2026-09-15T12:05:00.000Z");
    const firstBoundary = transfer("first-boundary", "2026-09-15T12:04:00.000Z", HASH_B);
    const older = transfer("older", "2026-09-15T12:02:00.000Z", HASH_C);
    const operations = [
      operation("recent", "2026-09-15T12:06:00.000Z"),
      operation("deferred", "2026-09-15T12:03:00.000Z"),
    ];
    const first = mergeActivityFeed({
      transfers: [newest, firstBoundary], operations, loadedThrough: firstBoundary.blockTimestamp,
    });
    const second = mergeActivityFeed({
      transfers: [newest, firstBoundary, older], operations, loadedThrough: older.blockTimestamp,
    });
    const ids = (items: typeof first) => items.map(({ kind, id }) => `${kind}:${id}`);

    expect(ids(first)).toEqual(["action:recent", `transfer:${newest.id}`, `transfer:${firstBoundary.id}`]);
    expect(ids(second)).toEqual([...ids(first), "action:deferred", `transfer:${older.id}`]);
  });

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
      loadedThrough: null,
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
      loadedThrough: null,
    });

    expect(items.map(({ id }) => id)).toEqual(["Beta", "alpha"]);
  });

  test("keeps input order for equal-time actions that share an id", () => {
    const first = { ...operation("same-action", "2026-09-15T12:00:00.000Z"), status: "pending" as const };
    const second = { ...operation("same-action", "2026-09-15T12:00:00.000Z"), status: "confirmed" as const };

    const items = mergeActivityFeed({ transfers: [], operations: [first, second], loadedThrough: null });

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
      loadedThrough: null,
    });

    expect(items.map(({ id }) => id)).toEqual([newerLog.id, olderLog.id]);
  });

  test("keeps the action and hides all indexed logs from its transaction", () => {
    const usdcOut = { ...transfer("usdc-out", "2026-09-15T12:02:00.000Z", HASH_A), direction: "outgoing" as const };
    const vaultSharesIn = { ...transfer("vault-shares-in", "2026-09-15T12:02:00.000Z", HASH_A), tokenSymbol: "vault shares" };
    const unrelated = transfer("unrelated", "2026-09-15T12:02:00.000Z", HASH_B);
    const matched = operation("Deposit USDC into Morpho", "2026-09-15T12:03:00.000Z", HASH_A);
    const items = mergeActivityFeed({
      transfers: [usdcOut, vaultSharesIn, unrelated],
      operations: [
        matched,
        { ...operation("unmatched-action", "2026-09-15T12:01:00.000Z", HASH_C), status: "pending" },
        { ...operation("hashless-action", "2026-09-15T12:00:00.000Z"), status: "unknown" },
      ],
      loadedThrough: null,
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      `transfer:${unrelated.id}`,
      "action:Deposit USDC into Morpho",
      "action:unmatched-action",
      "action:hashless-action",
    ]);
    expect(items[1]).toEqual({
      kind: "action",
      id: matched.action.id,
      timestamp: usdcOut.blockTimestamp,
      operation: { ...matched, updatedAt: usdcOut.blockTimestamp, action: { ...matched.action } },
      transfers: [usdcOut, vaultSharesIn],
    });
    expect(items.map((item) => item.kind === "action" ? item.operation.status : null))
      .toEqual([null, "confirmed", "pending", "unknown"]);
  });

  test("indexed pending and unknown actions become confirmed while failed actions stay failed", () => {
    const statuses = ["pending", "unknown", "failed", "confirmed"] as const;
    const operations = statuses.map((status, index) => ({
      ...operation(status, `2026-09-15T12:0${index}:00.000Z`, HASH_A),
      status,
    }));
    const items = mergeActivityFeed({
      transfers: [transfer("indexed", "2026-09-15T12:04:00.000Z", HASH_A)],
      operations,
      loadedThrough: null,
    });

    expect(items.map((item) => item.kind === "action" ? item.operation.status : null))
      .toEqual(["confirmed", "failed", "confirmed", "confirmed"]);
    expect(operations.map((operation) => operation.status)).toEqual([...statuses]);
  });

  test("keeps an unmatched hashed action when a later page loads its transfer", () => {
    const firstPage = [transfer("page-1", "2026-09-15T12:02:00.000Z", HASH_A)];
    const operations = [
      operation("unmatched-fallback", "2026-09-15T12:03:00.000Z", HASH_C),
      operation("hashless-fallback", "2026-09-15T12:01:00.000Z"),
    ];

    const beforeLoadingMore = mergeActivityFeed({ transfers: firstPage, operations, loadedThrough: null });
    expect(beforeLoadingMore.filter(({ kind }) => kind === "action").map(({ id }) => id))
      .toEqual(["unmatched-fallback", "hashless-fallback"]);
    expect(beforeLoadingMore.filter((item) => item.kind === "action")
      .map((item) => item.kind === "action" && [item.transfers, item.timestamp, item.operation.updatedAt]))
      .toEqual([
        [[], operations[0]!.updatedAt, operations[0]!.updatedAt],
        [[], operations[1]!.updatedAt, operations[1]!.updatedAt],
      ]);

    const laterPage = transfer("page-2-match", "2026-09-15T11:59:00.000Z", HASH_C);
    const afterLoadingMore = mergeActivityFeed({ transfers: [...firstPage, laterPage], operations, loadedThrough: null });
    expect(afterLoadingMore.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      `transfer:${firstPage[0]!.id}`,
      "action:hashless-fallback",
      "action:unmatched-fallback",
    ]);
    expect(afterLoadingMore[2]?.timestamp).toBe(laterPage.blockTimestamp);
    expect(afterLoadingMore.some(({ kind, id }) => kind === "transfer" && id === laterPage.id)).toBe(false);
  });

  test("matches transaction hashes case-insensitively", () => {
    const items = mergeActivityFeed({
      transfers: [transfer("loaded", "2026-09-15T12:02:00.000Z", HASH_A.toUpperCase() as `0x${string}`)],
      operations: [operation("matched", "2026-09-15T12:03:00.000Z", HASH_A)],
      loadedThrough: null,
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["action:matched"]);
    expect(items[0]?.kind === "action" && items[0].transfers).toEqual([transfer("loaded", "2026-09-15T12:02:00.000Z", HASH_A.toUpperCase() as `0x${string}`)]);
  });

  test("settles deposit spend and estimated vault shares by token and direction without changing previews", () => {
    const usdcOut = {
      ...transfer("usdc-out", "2026-09-15T12:04:00.000Z"),
      direction: "outgoing" as const,
      amountBaseUnits: "1300000",
    };
    const vaultIn = {
      ...transfer("vault-in", "2026-09-15T12:05:00.000Z"),
      tokenAddress: VAULT.toUpperCase() as `0x${string}`,
      tokenDecimals: 18,
      direction: "incoming" as const,
      amountBaseUnits: "800000000000000000",
    };
    const vaultInSecond = { ...vaultIn, id: "second-vault-log", amountBaseUnits: "200000000000000000" };
    const wrongDecimals = { ...vaultIn, id: "wrong-decimals", tokenDecimals: 6, amountBaseUnits: "5000000" };
    const selfTransfer = { ...vaultIn, id: "self", direction: "self" as const };
    const deposit = operation("deposit", "2026-09-15T12:06:00.000Z", HASH_A);
    deposit.action.kind = "savings-deposit";
    deposit.action.amounts = [
      { assetId: "USDC", symbol: "USDC", decimals: 6, amountBaseUnits: "1200000", direction: "spend", estimated: true },
      { assetId: `eip155:8453/erc20:${VAULT.toUpperCase()}`, symbol: "vault shares", decimals: 18,
        amountBaseUnits: "900000000000000000", direction: "receive", estimated: true },
      { assetId: "unknown-asset", symbol: "OTHER", decimals: 18, amountBaseUnits: "42", direction: "receive", estimated: true },
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "7", direction: "receive", estimated: true },
    ];

    const items = mergeActivityFeed({ transfers: [usdcOut, vaultIn, vaultInSecond, wrongDecimals, selfTransfer], operations: [deposit], loadedThrough: null });
    const settled = items[0];
    expect(settled?.kind).toBe("action");
    if (settled?.kind !== "action") return;
    expect(settled.transfers).toEqual([usdcOut, vaultIn, vaultInSecond, wrongDecimals, selfTransfer]);
    expect(settled.operation.action.amounts).toEqual([
      { assetId: "USDC", symbol: "USDC", decimals: 6, amountBaseUnits: "1300000", direction: "spend" },
      { assetId: `eip155:8453/erc20:${VAULT.toUpperCase()}`, symbol: "vault shares", decimals: 18,
        amountBaseUnits: "1000000000000000000", direction: "receive" },
      deposit.action.amounts[2],
      deposit.action.amounts[3],
    ]);
    expect(deposit.action.amounts[0]?.estimated).toBe(true);
    expect(deposit.action.amounts[1]?.amountBaseUnits).toBe("900000000000000000");
  });

  test("settles a repay-all estimated debt and maximum debit into one exact outgoing amount", () => {
    const repay = operation("repay-all", "2026-09-15T12:03:00.000Z", HASH_A);
    repay.action.kind = "repay";
    repay.action.amounts = [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000040", direction: "spend", estimated: true },
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000200", direction: "spend", maximum: true },
    ];
    const debit = { ...transfer("repay", "2026-09-15T12:02:00.000Z"), direction: "outgoing" as const,
      amountBaseUnits: "1000042", tokenDecimals: null };
    const [item] = mergeActivityFeed({ transfers: [debit], operations: [repay], loadedThrough: null });

    expect(item?.kind === "action" && item.operation.action.amounts).toEqual([
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000042", direction: "spend" },
    ]);
    expect(repay.action.amounts[1]?.maximum).toBe(true);
  });

  test("keeps prepared amounts when distinct actions share one transaction", () => {
    const first = operation("send-one", "2026-09-15T12:00:00.000Z", HASH_A);
    first.action.amounts = [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" },
    ];
    const second = operation("send-two", "2026-09-15T12:00:00.000Z", HASH_A);
    second.status = "pending";
    second.action.amounts = [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "2000000", direction: "spend" },
    ];
    const one = { ...transfer("one", "2026-09-15T12:01:00.000Z"), direction: "outgoing" as const, amountBaseUnits: "1000000" };
    const two = { ...transfer("two", "2026-09-15T12:01:00.000Z"), direction: "outgoing" as const, amountBaseUnits: "2000000" };
    const items = mergeActivityFeed({ transfers: [one, two], operations: [first, second], loadedThrough: null });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["action:send-one", "action:send-two"]);
    const amounts = items.map((item) => item.kind === "action" ? item.operation.action.amounts : []);
    expect(amounts).toEqual([first.action.amounts, second.action.amounts]);
    expect(items.map((item) => item.kind === "action" && item.operation.status)).toEqual(["confirmed", "confirmed"]);
    expect(items.map((item) => item.timestamp)).toEqual([one.blockTimestamp, one.blockTimestamp]);
  });

  test("uses the latest matched block time for both action date and feed ordering", () => {
    const first = transfer("first", "2026-09-15T12:01:00.000Z", HASH_A);
    const latest = transfer("latest", "2026-09-15T12:03:00.000Z", HASH_A);
    const other = transfer("other", "2026-09-15T12:02:00.000Z", HASH_B);
    const items = mergeActivityFeed({
      transfers: [latest, other, first],
      operations: [operation("settled", "2026-09-15T12:00:00.000Z", HASH_A)],
      loadedThrough: null,
    });

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["action:settled", `transfer:${other.id}`]);
    expect(items[0]?.kind === "action" && items[0].timestamp).toBe(latest.blockTimestamp);
    expect(items[0]?.kind === "action" && items[0].operation.updatedAt).toBe(latest.blockTimestamp);
    expect(items[0]?.kind === "action" && items[0].transfers).toEqual([latest, first]);
  });
});
