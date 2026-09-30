import { parseHash32 } from "@/shared/chain/hex";
import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityFundingOrder, ActivityCashoutOrder } from "@/shared/activity/contract-orders";
import type { ActivityTransfer } from "@/shared/activity/types";
import { activityOrdersNeedPolling, mergeActivityFeed } from "./activity-feed";
import { presentActivityLedgerItems } from "./activity-ledger-items";

const createdAt = "2026-09-15T12:00:00.000Z";
const updatedAt = "2026-09-15T12:01:00.000Z";
const clearableAt = "2026-09-15T12:02:00.000Z";
const hash = parseHash32(`0x${"ab".repeat(32)}`)!;
const funding: ActivityFundingOrder = {
  kind: "funding", id: "funding-1", region: "US", providerId: "coinbase", providerName: "Coinbase",
  paymentMethodLabel: "Debit card", status: "waiting-customer", stage: "awaiting-payment", instruction: "embed", resumable: true,
  fiatAmount: "25.00", fiatCurrency: "USD", asset: { id: "usdc", symbol: "USDC", decimals: 6 },
  tokenAmountAtomic: "25000000", sandbox: true, expiresAt: clearableAt, clearableAt: null,
  transactionHash: hash, logIndex: "1", createdAt, updatedAt,
};
const cashout: ActivityCashoutOrder = {
  kind: "cash-out", id: "action-1", orderId: "deposit-1", region: "US", providerId: "peer", providerName: "Peer",
  platform: "venmo", platformLabel: "Venmo", status: "waiting-provider", state: "awaiting-buyer",
  decimals: 6, amountAtomic: "25000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "25000000",
  withdrawable: true, settledAt: null, createdAt, updatedAt,
};
const operation: RecentMoneyActionOperation = {
  action: { id: "action-1", kind: "cash-out", title: "Cash out", amounts: [], warnings: [], createdAt, expiresAt: clearableAt },
  status: "confirmed", createdAt, updatedAt,
};
const transfer: ActivityTransfer = {
  id: "transfer-1", logId: "log-1", chainId: 8453, assetId: "usdc", tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null, walletAddress: "0x1111111111111111111111111111111111111111",
  fromAddress: "0x2222222222222222222222222222222222222222", toAddress: "0x1111111111111111111111111111111111111111",
  direction: "incoming", amountBaseUnits: "25000000", blockNumber: "1", blockHash: hash, transactionHash: hash,
  logIndex: "1", blockTimestamp: createdAt, valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
};
const present = (order: ActivityFundingOrder | ActivityCashoutOrder, regionId: "US" | "GB" = "US", now = Date.parse(updatedAt)) =>
  presentActivityLedgerItems([{ kind: "order", id: order.id, timestamp: order.updatedAt, order }], { regionId, now, timeZone: "UTC" })[0]!;
const withdraw = (status: RecentMoneyActionOperation["status"]): RecentMoneyActionOperation => ({
  action: { id: `withdraw-${status}`, kind: "cash-out-withdraw", title: "Withdraw", amounts: [], warnings: [], createdAt, expiresAt: clearableAt,
    metadata: { product: "cashout", operation: "withdraw", depositId: "DEPOSIT-1" } as RecentMoneyActionOperation["action"]["metadata"] },
  status, createdAt, updatedAt,
});
const presentWithWithdrawal = (order: ActivityCashoutOrder, status: RecentMoneyActionOperation["status"]) => {
  const item = mergeActivityFeed({ transfers: [], operations: [withdraw(status)], orders: [order], loadedThrough: null })
    .find((entry) => entry.kind === "order")!;
  return presentActivityLedgerItems([item], { regionId: "US", now: Date.parse(updatedAt), timeZone: "UTC" })[0]!;
};

describe("Activity orders", () => {
  test("reconciles the cash-out action and funding receipt without hiding the order", () => {
    const items = mergeActivityFeed({ transfers: [transfer], operations: [operation], orders: [funding, cashout], loadedThrough: null });
    expect(items.map(({ kind, id }) => [kind, id])).toEqual([["order", cashout.id], ["order", funding.id]]);
    expect(mergeActivityFeed({ transfers: [{ ...transfer, transactionHash: hash.toUpperCase() as `0x${string}` }], operations: [], orders: [funding], loadedThrough: null })
      .map(({ kind }) => kind)).toEqual(["order"]);
  });

  test("shows a cash-out once, preferring whichever representation carries the newer progress", () => {
    const snapshot = { version: 1 as const, providerId: "peer", region: "US", depositId: "deposit-1", state: "awaiting-buyer" as const,
      platform: "venmo", platformLabel: "Venmo", amountAtomic: "25000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "25000000",
      withdrawable: true, withdrawing: false, etaSeconds: null, settledAt: null, updatedAt };
    const merge = (op: RecentMoneyActionOperation, order: ActivityCashoutOrder) =>
      mergeActivityFeed({ transfers: [], operations: [op], orders: [order], loadedThrough: null }).map(({ kind, id }) => [kind, id]);
    expect(merge(operation, cashout)).toEqual([["order", cashout.id]]);
    expect(merge({ ...operation, cashout: snapshot }, cashout)).toEqual([["action", operation.action.id]]);
    expect(merge({ ...operation, cashout: { ...snapshot, updatedAt: createdAt } }, { ...cashout, state: "returned" }))
      .toEqual([["order", cashout.id]]);
  });

  test("a newer cash-out order still absorbs the stale action's transfer and linked withdrawal", () => {
    const staleSnapshot = { version: 1 as const, providerId: "peer", region: "US", depositId: "deposit-1", state: "awaiting-buyer" as const,
      platform: "venmo", platformLabel: "Venmo", amountAtomic: "25000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "25000000",
      withdrawable: true, withdrawing: false, etaSeconds: null, settledAt: null, updatedAt: createdAt };
    const staleAction: RecentMoneyActionOperation = { ...operation, transactionHash: hash, cashout: staleSnapshot };
    const withdraw: RecentMoneyActionOperation = {
      action: { id: "withdraw-1", kind: "cash-out-withdraw", title: "Withdraw", amounts: [], warnings: [], createdAt, expiresAt: clearableAt,
        metadata: { product: "cashout", operation: "withdraw", depositId: "deposit-1" } as RecentMoneyActionOperation["action"]["metadata"] },
      status: "pending", createdAt, updatedAt,
    };
    const outgoing = { ...transfer, direction: "outgoing" as const };
    const items = mergeActivityFeed({ transfers: [outgoing], operations: [staleAction, withdraw], orders: [cashout], loadedThrough: null });
    expect(items.map(({ kind, id }) => [kind, id])).toEqual([["order", cashout.id]]);
    expect(items[0]!.kind === "order" ? items[0]!.withdraw?.action.id : undefined).toBe("withdraw-1");
  });

  test("keeps polling a still-open funding order whose expiry is only inferred", () => {
    const inferredExpired = { ...funding, status: "expired" as const, stage: "expired" as const };
    expect(activityOrdersNeedPolling([inferredExpired])).toBe(true);
    expect(activityOrdersNeedPolling([{ ...inferredExpired, resumable: false }])).toBe(false);
    expect(activityOrdersNeedPolling([{ ...funding, status: "confirmed", stage: "received", resumable: false }])).toBe(false);
    expect(activityOrdersNeedPolling([{ ...cashout, status: "confirmed" }])).toBe(false);
    expect(activityOrdersNeedPolling([cashout])).toBe(true);
  });

  test("suppresses only the verified funding receipt log in a transaction with other transfers", () => {
    const unrelated = { ...transfer, id: "transfer-2", logId: "log-2", logIndex: "2" };
    const items = mergeActivityFeed({ transfers: [transfer, unrelated], operations: [], orders: [funding], loadedThrough: null });
    expect(items.filter((item) => item.kind === "transfer").map((item) => item.id)).toEqual(["transfer-2"]);
    expect(mergeActivityFeed({ transfers: [transfer, unrelated], operations: [], orders: [{ ...funding, logIndex: null }], loadedThrough: null })
      .filter((item) => item.kind === "transfer").map((item) => item.id)).toEqual(["transfer-2", "transfer-1"]);
  });

  test("holds old settled orders behind transfers, but keeps pending and reversed ones", () => {
    const old = { ...funding, status: "confirmed" as const, updatedAt: createdAt };
    const newest = mergeActivityFeed({ transfers: [], operations: [], orders: [old, cashout], loadedThrough: updatedAt });
    expect(newest.map(({ id }) => id)).toEqual([cashout.id]);
    expect(mergeActivityFeed({ transfers: [], operations: [], orders: [old], loadedThrough: null })).toHaveLength(1);
    expect(mergeActivityFeed({ transfers: [], operations: [], orders: [{ ...cashout, status: "reversed", updatedAt: createdAt }], loadedThrough: updatedAt })).toHaveLength(1);
  });

  test("funding stages show owner steps and stable title without retry actions", () => {
    expect(present(funding)).toMatchObject({ title: "Add money", amount: "+$25.00", status: "waiting-customer",
      steps: [{ title: "Order created", status: "complete", time: "Sep 15, 2026, 12:00 PM" },
        { title: "Waiting for your payment", status: "current", time: "Pay by Sep 15, 2026, 12:02 PM" }],
      nextAction: { kind: "resume", label: "Continue with Coinbase" },
      detail: { provider: "Coinbase", paymentMethod: "Debit card", orderId: funding.id } });
    expect(present(funding, "GB").nextAction).toBeUndefined();
    expect(present({ ...funding, instruction: "bank-transfer" }).nextAction).toEqual({ kind: "complete-payment", label: "Complete payment" });
    expect(present({ ...funding, status: "waiting-provider", stage: "provider-processing" }).steps?.map((s) => s.title))
      .toEqual(["Order created", "Payment received", "Waiting on Coinbase"]);
    expect(present({ ...funding, status: "waiting-chain", stage: "arriving" }).steps?.map((s) => s.title))
      .toEqual(["Order created", "Payment received", "Sent by Coinbase", "Arriving on Base"]);
    for (const [stage, label] of [["received", undefined], ["cleared", "Cleared"], ["cancelled", "Cancelled"], ["failed", undefined], ["expired", undefined]] as const) {
      const row = present({ ...funding, status: stage === "received" ? "confirmed" : "failed", stage });
      expect(row.title).toBe("Add money");
      expect(row.statusLabel).toBe(label);
      expect(row.nextAction).toBeUndefined();
      expect(row.steps).toBeUndefined();
    }
  });

  test("only the selected open order gets Continue or Complete payment", () => {
    for (const instruction of ["embed", "bank-transfer"] as const) {
      const older = { ...funding, id: "older", updatedAt: createdAt, instruction, resumable: false };
      const newer = { ...funding, id: "newer", instruction, resumable: true };
      expect(present(older).nextAction).toBeUndefined();
      expect(present(newer).nextAction?.kind).toBe(instruction === "embed" ? "resume" : "complete-payment");
    }
  });

  test("unconfirmed funding can only clear after its deadline, with no retry", () => {
    const ambiguous = { ...funding, status: "ambiguous" as const, stage: "unconfirmed" as const, clearableAt };
    expect(present(ambiguous, "US", Date.parse(updatedAt))).toMatchObject({
      ownerSentence: { title: "We can't confirm this yet", description: "Don't try again. You can clear it after Sep 15, 2026, 12:02 PM." },
    });
    expect(present(ambiguous, "US", Date.parse(updatedAt)).nextAction).toBeUndefined();
    expect(present(ambiguous, "US", Date.parse(clearableAt)).nextAction).toEqual({ kind: "clear-order", label: "Clear order" });
    expect(present({ ...ambiguous, stage: "failed" }, "US", Date.parse(clearableAt)).nextAction).toBeUndefined();
  });

  test("cash-out fallback offers withdrawal only for a reversible deposit", () => {
    expect(present(cashout)).toMatchObject({ family: "cash-out-order", title: "Cash out to Venmo", amount: "−$25",
      steps: [{ title: "Waiting for a buyer", status: "current" }], detail: { orderId: "deposit-1" } });
    expect(present({ ...cashout, state: "matched" }).steps?.[0]?.title).toBe("Buyer paying you");
    expect(present({ ...cashout, status: "waiting-chain" }).steps?.[0]?.title).toBe("Returning to your balance");
    expect(present({ ...cashout, status: "refunded", state: "returned" }).statusLabel).toBe("Returned");
    const reversed = { ...cashout, status: "reversed" as const };
    expect(present(reversed)).toMatchObject({ ownerSentence: { title: "$25 came back", description: "Withdraw it to your balance." },
      nextAction: { kind: "withdraw-returned-funds", label: "Withdraw $25" } });
    expect(present({ ...reversed, withdrawable: false }).nextAction).toBeUndefined();
    expect(present({ ...reversed, orderId: null }).nextAction).toBeUndefined();
  });

  test("cash-out fallback offers cancellation while an unfilled deposit waits for a buyer", () => {
    expect(present(cashout).nextAction).toEqual({ kind: "cancel-cash-out", label: "Cancel cash-out $25" });
    expect(present({ ...cashout, state: "submitted", filledAtomic: "10000000", remainingAtomic: "15000000" }).nextAction)
      .toEqual({ kind: "cancel-cash-out", label: "Cancel cash-out $15" });
    for (const blocked of [{ state: "matched" as const }, { withdrawable: false }, { orderId: null }, { remainingAtomic: "0" }]) {
      expect(present({ ...cashout, ...blocked }).nextAction).toBeUndefined();
    }
  });

  test("cash-out fallback keeps the paid and returned breakdown of a partial fill", () => {
    const partial = { ...cashout, status: "refunded" as const, state: "returned" as const, amountAtomic: "50000000",
      filledAtomic: "30000000", returnedAtomic: "20000000", remainingAtomic: "0", withdrawable: false, settledAt: updatedAt };
    const detail = present(partial).detail;
    expect(detail.family === "cash-out-order" ? detail.facts : undefined)
      .toEqual([{ label: "Paid", value: "$30" }, { label: "Returned", value: "$20" }]);
    const full = present({ ...partial, filledAtomic: "50000000", returnedAtomic: "0", status: "confirmed", state: "delivered" }).detail;
    expect(full.family === "cash-out-order" ? full.facts : null).toBeUndefined();
  });

  test("cash-out fallback withholds cancel and withdraw while a withdrawal is unresolved", () => {
    for (const status of ["pending", "unknown", "confirmed"] as const) {
      expect(presentWithWithdrawal(cashout, status).nextAction).toBeUndefined();
      expect(presentWithWithdrawal({ ...cashout, status: "reversed" }, status).nextAction).toBeUndefined();
    }
    expect(presentWithWithdrawal(cashout, "failed").nextAction?.kind).toBe("cancel-cash-out");
    expect(presentWithWithdrawal({ ...cashout, status: "reversed" }, "failed").nextAction?.kind).toBe("withdraw-returned-funds");
  });

  test("cash-out order returns to balance instead of waiting for a buyer when withdrawal is underway", () => {
    for (const status of ["pending", "unknown", "confirmed"] as const) {
      for (const state of ["awaiting-buyer", "matched"] as const) {
        const row = presentWithWithdrawal({ ...cashout, state }, status);
        expect(row.status).toBe("waiting-chain");
        expect(row.steps).toEqual([{ status: "current", title: "Returning to your balance" }]);
        expect(row.ownerSentence).toEqual({ title: "Returning to your balance" });
        expect(row.nextAction).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain("Waiting for a buyer");
        expect(JSON.stringify(row)).not.toContain("Buyer paying you");
      }
      const unconfirmed = presentWithWithdrawal({ ...cashout, status: "ambiguous", state: "unknown" }, status);
      expect(unconfirmed.status).toBe("waiting-chain");
      expect(unconfirmed.steps).toEqual([{ status: "current", title: "Returning to your balance" }]);
      expect(unconfirmed.nextAction).toBeUndefined();
    }
  });

  test("reversed cash-out order stops asking for withdrawal once it is underway", () => {
    const reversed = { ...cashout, status: "reversed" as const, state: "returned" as const };
    for (const status of ["pending", "unknown", "confirmed"] as const) {
      const row = presentWithWithdrawal(reversed, status);
      expect(row.status).toBe("waiting-chain");
      expect(row.steps).toEqual([{ status: "current", title: "Returning to your balance" }]);
      expect(row.ownerSentence).toEqual({ title: "Returning to your balance" });
      expect(row.nextAction).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain("Withdraw it to your balance");
    }
    const failed = presentWithWithdrawal(reversed, "failed");
    expect(failed.status).toBe("reversed");
    expect(failed.ownerSentence).toEqual({ title: "$25 came back", description: "Withdraw it to your balance." });
    expect(failed.nextAction).toEqual({ kind: "withdraw-returned-funds", label: "Withdraw $25" });
    expect(failed.steps).toBeUndefined();
  });

  test("settled cash-out orders stay final despite a linked withdrawal", () => {
    for (const [status, state] of [["confirmed", "delivered"], ["refunded", "returned"], ["failed", "failed"]] as const) {
      const row = presentWithWithdrawal({ ...cashout, status, state, withdrawable: false, settledAt: updatedAt }, "confirmed");
      expect(row.status).toBe(status);
      expect(row.steps).toBeUndefined();
      expect(row.ownerSentence).toBeUndefined();
      expect(row.nextAction).toBeUndefined();
    }
  });
});
