import { expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityTransfer } from "@/shared/activity/types";
import { mergeActivityFeed } from "./activity-feed";

const hash = `0x${"a".repeat(64)}` as `0x${string}`;
const deposit: RecentMoneyActionOperation = {
  action: { id: "deposit", kind: "cash-out", title: "Cash out", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }], warnings: [], expiresAt: "", createdAt: "" },
  status: "confirmed", createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z", transactionHash: hash,
  cashout: { version: 1, providerId: "peer", region: "US", depositId: "escrow", state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 3600, settledAt: null, updatedAt: "2026-09-15T12:00:00Z" },
};
const withdrawingDeposit: RecentMoneyActionOperation = { ...deposit, cashout: { ...deposit.cashout!, withdrawing: true } };
const withdrawalMetadata = {
  product: "cashout", operation: "withdraw", depositId: "escrow", providerId: "peer", providerName: "Peer", environment: "sandbox", platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "50", minConversionRate: "1", intentAmountRange: { min: "50000000", max: "50000000" }, estimateAsOf: "2026-09-15T12:00:00Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
} as const;
const withdrawal: RecentMoneyActionOperation = {
  ...deposit, transactionHash: `0x${"b".repeat(64)}`,
  action: { ...deposit.action, id: "withdrawal", kind: "cash-out-withdraw", metadata: withdrawalMetadata },
  status: "pending", cashout: undefined,
};
const transfer: ActivityTransfer = {
  id: "transfer", logId: "transfer", chainId: 8453, assetId: "usdc", tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null,
  walletAddress: "0x1111111111111111111111111111111111111111", fromAddress: "0x1111111111111111111111111111111111111111", toAddress: "0x2222222222222222222222222222222222222222", direction: "outgoing", amountBaseUnits: "50000000", blockNumber: "1", blockHash: hash, transactionHash: hash, logIndex: "1", blockTimestamp: "2026-09-15T12:00:01Z", valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
};

test("pins an in-progress deposit, folds its linked withdraw, and merges the escrow transfer", () => {
  const unrelated: RecentMoneyActionOperation = {
    ...withdrawal, action: { ...withdrawal.action, id: "unrelated", metadata: {
      product: "cashout", operation: "withdraw", depositId: "other", providerId: "peer", providerName: "Peer", environment: "sandbox", platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "50", minConversionRate: "1", intentAmountRange: { min: "50000000", max: "50000000" }, estimateAsOf: "2026-09-15T12:00:00Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
    } },
  };
  const items = mergeActivityFeed({ transfers: [transfer], operations: [unrelated, withdrawal, withdrawingDeposit], loadedThrough: null });
  expect(items.map((item) => item.id)).toEqual(["deposit", "unrelated"]);
  const first = items[0];
  expect(first?.kind).toBe("action");
  if (first?.kind !== "action") return;
  expect(first.withdraw?.action.id).toBe("withdrawal");
  expect(first.transfers).toEqual([transfer]);
});

test("shows an older in-progress cash-out before an unfinished transfer page reaches it", () => {
  const items = mergeActivityFeed({ transfers: [], operations: [deposit], loadedThrough: "2026-09-15T13:00:00Z" });
  expect(items.map((item) => item.id)).toEqual(["deposit"]);
});

test("folds a mixed-case withdrawal deposit ID into a lowercase cash-out deposit ID", () => {
  const lowerId = "0x777777779d229cdf3110e9de47943791c26300ef_7";
  const mixedId = "0x777777779d229cdF3110e9de47943791c26300Ef_7";
  const cashout = { ...withdrawingDeposit, cashout: { ...withdrawingDeposit.cashout!, depositId: lowerId } };
  const mixedWithdrawal = { ...withdrawal, action: { ...withdrawal.action, metadata: { ...withdrawalMetadata, depositId: mixedId } } };
  const items = mergeActivityFeed({ transfers: [], operations: [mixedWithdrawal, cashout], loadedThrough: null });
  expect(items.map((item) => item.id)).toEqual(["deposit"]);
  const first = items[0];
  expect(first?.kind).toBe("action");
  if (first?.kind !== "action") return;
  expect(first.withdraw?.action.id).toBe("withdrawal");
});

test("folds every linked withdrawal and prefers an unsettled attempt over a newer failure", () => {
  const live = { ...withdrawal, updatedAt: "2026-09-15T12:01:00Z", action: { ...withdrawal.action, id: "live" }, status: "pending" as const };
  const failed = { ...withdrawal, updatedAt: "2026-09-15T12:02:00Z", transactionHash: `0x${"c".repeat(64)}` as `0x${string}`, action: { ...withdrawal.action, id: "failed" }, status: "failed" as const };
  const items = mergeActivityFeed({ transfers: [], operations: [failed, live, withdrawingDeposit], loadedThrough: null });
  expect(items.map((item) => item.id)).toEqual(["deposit"]);
  const first = items[0];
  expect(first?.kind).toBe("action");
  if (first?.kind !== "action") return;
  expect(first.withdraw?.action.id).toBe("live");
});

test("folds a confirmed withdrawal ahead of a newer unknown attempt", () => {
  const confirmed = { ...withdrawal, status: "confirmed" as const, updatedAt: "2026-09-15T12:01:00Z" };
  const unknown = { ...withdrawal, action: { ...withdrawal.action, id: "unknown" }, status: "unknown" as const, updatedAt: "2026-09-15T12:02:00Z" };
  const items = mergeActivityFeed({ transfers: [], operations: [unknown, confirmed, deposit], loadedThrough: null });
  expect(items[0]?.kind === "action" && items[0].withdraw?.action.id).toBe("withdrawal");
});
