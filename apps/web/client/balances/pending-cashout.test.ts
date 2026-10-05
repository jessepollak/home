import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import { selectPendingCashoutEscrow, usePendingCashoutEscrow } from "./pending-cashout";

const { cleanup, renderHook, waitFor } = await import("@testing-library/react");

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

const snapshot = buildBalancesSnapshotFixture();
const deposit: RecentMoneyActionOperation = {
  action: { id: "cashout", kind: "cash-out", title: "Cash out", amounts: [], warnings: [], expiresAt: "", createdAt: "" },
  status: "confirmed", createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z",
  cashout: { version: 1, providerId: "peer", region: "US", depositId: "escrow-1", depositBlockNumber: snapshot.block.number, progressConfirmed: true,
    state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0",
    returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 1800,
    settledAt: null, updatedAt: "2026-09-15T12:00:00Z" },
};
const withdrawalMetadata = { product: "cashout", operation: "withdraw", depositId: "escrow-1", providerId: "peer", providerName: "Peer",
  environment: "production", platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "0",
  minConversionRate: "1", intentAmountRange: { min: "1", max: "2" }, estimateAsOf: "", escrow: "0x0000000000000000000000000000000000000001" } as const;
const withdraw = (status: RecentMoneyActionOperation["status"]): RecentMoneyActionOperation => ({
  ...deposit, status, action: { ...deposit.action, id: `withdraw-${status}`, kind: "cash-out-withdraw", metadata: withdrawalMetadata }, cashout: undefined,
});
const withProgress = (changes: Partial<NonNullable<RecentMoneyActionOperation["cashout"]>>): RecentMoneyActionOperation =>
  ({ ...deposit, cashout: { ...deposit.cashout!, ...changes } });

const session: VerifiedAccountSession = {
  user: { subject: "cashout-estimate-owner" }, smartAccount: { address: snapshot.owner.address, chainId: 8453 }, accountProvider: "cdp-embedded",
};

test("an exhaustive version 1 list permits a known empty cash-out estimate", async () => {
  const fetchOperations = async () => ({ version: 1, truncated: false, actions: [] });
  const { result } = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations));
  await waitFor(() => expect(result.current).toBeNull());
});

test.each([
  ["version 1 truncated", { version: 1, truncated: true, actions: [] }],
  ["missing version", { truncated: false, actions: [] }],
  ["old version", { version: 0, truncated: false, actions: [] }],
  ["unknown version", { version: 2, truncated: false, actions: [] }],
] as const)("a %s list keeps the cash-out estimate unreadable", async (_label, payload) => {
  const fetchOperations = async () => payload;
  const { result } = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations));
  await waitFor(() => expect(result.current).toEqual({ state: "unreadable" }));
});

test("a list read error keeps the cash-out estimate unreadable", async () => {
  const fetchOperations = async () => { throw new Error("Actions unavailable"); };
  const { result } = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations));
  await waitFor(() => expect(result.current).toEqual({ state: "unreadable" }));
});

test("selects only the remaining escrow of eligible pending Peer orders", () => {
  expect(selectPendingCashoutEscrow([], snapshot)).toBeNull();
  expect(selectPendingCashoutEscrow([deposit], snapshot)).toEqual({ state: "escrow", baseUnits: "50000000", partial: false });
  const partial = withProgress({ state: "matched", filledAtomic: "30000000", remainingAtomic: "20000000" });
  expect(selectPendingCashoutEscrow([deposit, { ...partial, action: { ...partial.action, id: "cashout-2" } }], snapshot))
    .toEqual({ state: "escrow", baseUnits: "70000000", partial: false });
  expect(selectPendingCashoutEscrow([partial], snapshot)).toEqual({ state: "escrow", baseUnits: "20000000", partial: false });
});

test.each([
  ["no deposit id", withProgress({ depositId: null }), undefined],
  ["unconfirmed progress", withProgress({ progressConfirmed: false }), undefined],
  ["missing confirmation", withProgress({ progressConfirmed: undefined }), undefined],
  ["no progress after parsing", { ...deposit, cashout: undefined }, undefined],
  ["failed without progress", { ...deposit, status: "failed" as const, cashout: undefined }, undefined],
  ["unknown without order", { ...deposit, status: "unknown" as const, cashout: undefined }, undefined],
  ["no observed deposit block", withProgress({ depositBlockNumber: undefined }), undefined],
  ["malformed deposit block", withProgress({ depositBlockNumber: "bad" }), undefined],
  ["malformed remaining", withProgress({ remainingAtomic: "bad" }), undefined],
  ["unknown order", withProgress({ state: "unknown", depositId: null }), undefined],
  ["linked return", deposit, withdraw("confirmed")],
] as const)("marks %s indeterminate", (_label, operation, linkedWithdraw) => {
  expect(selectPendingCashoutEscrow(linkedWithdraw ? [operation, linkedWithdraw] : [operation], snapshot))
    .toEqual({ state: "indeterminate" });
  const known = withProgress({ depositId: "known-escrow" });
  expect(selectPendingCashoutEscrow([known, { ...operation, action: { ...operation.action, id: "other" } }, ...(linkedWithdraw ? [linkedWithdraw] : [])], snapshot))
    .toEqual({ state: "escrow", baseUnits: "50000000", partial: true });
});

test.each([
  ["settled return", withProgress({ state: "returned", settledAt: "2026-09-15T13:00:00Z" })],
  ["delivered unconfirmed", withProgress({ state: "delivered", progressConfirmed: false })],
  ["delivered", withProgress({ state: "delivered" })],
  ["returned", withProgress({ state: "returned" })],
  ["failed", withProgress({ state: "failed" })],
] as const)("omits %s", (_label, operation) => {
  expect(selectPendingCashoutEscrow([operation], snapshot)).toBeNull();
});
test("zero remaining is known empty", () => {
  expect(selectPendingCashoutEscrow([withProgress({ remainingAtomic: "0" })], snapshot)).toBeNull();
});

test("omits escrow until the pinned wallet balance block reaches the deposit block", () => {
  const stale = { ...snapshot, block: { ...snapshot.block, number: (BigInt(snapshot.block.number) - BigInt(1)).toString() } };
  expect(selectPendingCashoutEscrow([deposit], stale)).toBeNull();
});

test("an unconfirmed order ahead of the snapshot is omitted without marking the total partial", () => {
  const stale = { ...snapshot, block: { ...snapshot.block, number: (BigInt(snapshot.block.number) - BigInt(1)).toString() } };
  expect(selectPendingCashoutEscrow([withProgress({ progressConfirmed: false })], stale)).toBeNull();
});

test("an ahead-of-snapshot deposit with a pending return is indeterminate", () => {
  const stale = { ...snapshot, block: { ...snapshot.block, number: (BigInt(snapshot.block.number) - BigInt(1)).toString() } };
  expect(selectPendingCashoutEscrow([deposit, withdraw("pending")], stale)).toEqual({ state: "indeterminate" });
});

test.each(["pending", "unknown", "confirmed"] as const)("marks a %s withdrawal indeterminate", (status) => {
  expect(selectPendingCashoutEscrow([deposit, withdraw(status)], snapshot)).toEqual({ state: "indeterminate" });
});

test.each([
  ["pending", { state: "indeterminate" }],
  ["unknown", { state: "indeterminate" }],
  ["failed", null],
] as const)("reconciles a returned deposit with a %s withdrawal", (status, expected) => {
  const returned = withProgress({ state: "returned", returnedAtomic: "50000000", remainingAtomic: "0" });
  expect(selectPendingCashoutEscrow([returned, withdraw(status)], snapshot)).toEqual(expected);
  const known = withProgress({ depositId: "known-escrow" });
  expect(selectPendingCashoutEscrow([returned, withdraw(status), { ...known, action: { ...known.action, id: "known-cashout" } }], snapshot))
    .toEqual({ state: "escrow", baseUnits: "50000000", partial: expected !== null });
});

test.each([
  ["block ahead of snapshot", (BigInt(snapshot.block.number) + BigInt(1)).toString(), undefined, { state: "indeterminate" }],
  ["block at snapshot", snapshot.block.number, undefined, null],
  ["block before snapshot", (BigInt(snapshot.block.number) - BigInt(1)).toString(), undefined, null],
  ["missing block and unsettled", undefined, undefined, { state: "indeterminate" }],
  ["missing block and settled", undefined, "2026-09-15T13:00:00Z", null],
] as const)("reconciles a confirmed withdrawal with %s", (_label, receiptBlockNumber, settledAt, expected) => {
  const linkedWithdraw = { ...withdraw("confirmed"), receiptBlockNumber, settledAt };
  const returned = withProgress({ state: "returned", returnedAtomic: "50000000", remainingAtomic: "0" });
  expect(selectPendingCashoutEscrow([returned, linkedWithdraw], snapshot)).toEqual(expected);
  const known = withProgress({ depositId: "known-escrow" });
  expect(selectPendingCashoutEscrow([returned, linkedWithdraw, { ...known, action: { ...known.action, id: "known-cashout" } }], snapshot))
    .toEqual({ state: "escrow", baseUnits: "50000000", partial: expected !== null });
});

test.each([
  ["confirmed block ahead of snapshot", { ...withdraw("confirmed"), receiptBlockNumber: (BigInt(snapshot.block.number) + BigInt(1)).toString() }, { state: "indeterminate" }],
  ["confirmed block at snapshot", { ...withdraw("confirmed"), receiptBlockNumber: snapshot.block.number }, null],
  ["confirmed block before snapshot", { ...withdraw("confirmed"), receiptBlockNumber: (BigInt(snapshot.block.number) - BigInt(1)).toString() }, null],
  ["confirmed missing block and unsettled", withdraw("confirmed"), { state: "indeterminate" }],
  ["confirmed missing block and settled", { ...withdraw("confirmed"), settledAt: "2026-09-15T13:00:00Z" }, null],
  ["pending", withdraw("pending"), { state: "indeterminate" }],
  ["unknown", withdraw("unknown"), { state: "indeterminate" }],
  ["failed", withdraw("failed"), null],
] as const)("reconciles a withdrawal-only list with %s", (_label, withdrawal, expected) => {
  expect(selectPendingCashoutEscrow([withdrawal], snapshot)).toEqual(expected);
  const known = withProgress({ depositId: "known-escrow" });
  expect(selectPendingCashoutEscrow([withdrawal, known], snapshot))
    .toEqual({ state: "escrow", baseUnits: "50000000", partial: expected !== null });
});

test("a failed linked withdrawal does not hide still-escrowed funds", () => {
  expect(selectPendingCashoutEscrow([deposit, withdraw("failed")], snapshot)).toEqual({ state: "escrow", baseUnits: "50000000", partial: false });
});
