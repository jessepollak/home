import { expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import { selectPendingCashoutEscrow } from "./pending-cashout";
import { presentBalances, presentPendingCashout } from "@/shared/balances/present";

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
test.each(["unknown", "failed"] as const)("a %s cash-out without a projection leaves Home partial and Cash with a placeholder", (status) => {
  const priced = buildBalancesSnapshotFixture();
  priced.holdings.find(({ id }) => id === "usdc")!.unitValue = { currency: "USD", amount: { atoms: "1", scale: 0 } };
  const estimate = selectPendingCashoutEscrow([{ ...deposit, status, cashout: undefined }], priced);
  expect(estimate).toEqual({ state: "indeterminate" });
  const state = { status: "ready" as const, snapshot: priced, error: null };
  const view = presentBalances(state, { showSmallBalances: false, pendingCashout: estimate });
  expect(view.displayTotal).toBe(presentBalances(state).displayTotal);
  expect(view.breakdown.some(({ id }) => id === "pending-cash-out")).toBeFalse();
  expect(view.totalStatus).toBe("partial");
  expect(presentPendingCashout(priced, estimate)).toEqual({ value: null });
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

test("an ahead-of-snapshot deposit with a pending return is skipped without a partial total", () => {
  const stale = { ...snapshot, block: { ...snapshot.block, number: (BigInt(snapshot.block.number) - BigInt(1)).toString() } };
  expect(selectPendingCashoutEscrow([deposit, withdraw("pending")], stale)).toBeNull();
});

test.each(["pending", "unknown", "confirmed"] as const)("marks a %s withdrawal indeterminate", (status) => {
  expect(selectPendingCashoutEscrow([deposit, withdraw(status)], snapshot)).toEqual({ state: "indeterminate" });
});

test("a failed linked withdrawal does not hide still-escrowed funds", () => {
  expect(selectPendingCashoutEscrow([deposit, withdraw("failed")], snapshot)).toEqual({ state: "escrow", baseUnits: "50000000", partial: false });
});
