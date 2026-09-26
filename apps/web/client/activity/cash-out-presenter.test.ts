import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { CashoutProgressState } from "@/shared/funding/contracts/cash-out-progress";
import { linkedCashoutWithdraw, presentCashout, presentCashoutDetails } from "./cash-out-presenter";

const operation: RecentMoneyActionOperation = {
  action: { id: "deposit", kind: "cash-out", title: "Cash out", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }], warnings: [], expiresAt: "", createdAt: "" },
  status: "confirmed", createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z",
  cashout: { version: 1, providerId: "peer", region: "US", depositId: "escrow-1", state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0", remainingAtomic: "50000000", returnedAtomic: "0", withdrawable: true, withdrawing: false, etaSeconds: 3600, settledAt: null, updatedAt: "2026-09-15T12:00:00Z" },
};
function withState(state: CashoutProgressState, changes: Partial<NonNullable<RecentMoneyActionOperation["cashout"]>> = {}): RecentMoneyActionOperation {
  return { ...operation, cashout: { ...operation.cashout!, state, ...changes } };
}
const withdraw = (status: RecentMoneyActionOperation["status"]): RecentMoneyActionOperation => ({ ...operation, action: { ...operation.action, kind: "cash-out-withdraw" }, status });

describe("cash-out presentation", () => {
  test.each([
    ["submitted", "waiting", "Waiting for a buyer"],
    ["awaiting-buyer", "waiting", "Waiting for a buyer"],
    ["matched", "paying", "Buyer paying you"],
    ["delivering", "paying", "Buyer paying you"],
    ["delivered", "paid", "Paid to Cash App"],
    ["returned", "returned", "Returned"],
    ["failed", "failed", "Cash-out failed"],
    ["unknown", "checking", "Checking status"],
  ] as const)("%s shows %s", (state, stage, status) => {
    const view = presentCashout(withState(state));
    expect([view.stage, view.status, view.label]).toEqual([stage, status, "$50 to Cash App"]);
  });
  test("without a projection, a pending or confirmed deposit still waits", () => {
    expect(presentCashout({ ...operation, cashout: undefined }).status).toBe("Waiting for a buyer");
    expect(presentCashout({ ...operation, status: "pending", cashout: undefined }).stage).toBe("waiting");
  });
  test("a failed action with a linked withdrawable provider order stays waiting and cancellable", () => {
    const failed = { ...operation, status: "failed" as const };
    const view = presentCashout(failed);
    expect([view.stage, view.status, view.cancellable, view.inProgress]).toEqual(["waiting", "Waiting for a buyer", true, true]);
    expect(presentCashoutDetails(failed).rows[0]).toEqual({ label: "Status", value: "Waiting for a buyer", statusTone: "pending" });
    expect(presentCashoutDetails(failed).rows).toContainEqual({ label: "Network", value: "Base", network: "base" });
    expect(presentCashout({ ...failed, cashout: { ...failed.cashout!, withdrawing: true } }, withdraw("pending")).stage).toBe("returning");
  });
  test("an unknown action follows its linked provider progress", () => {
    const unknown = { ...operation, status: "unknown" as const };
    expect([presentCashout(unknown).stage, presentCashout(unknown).cancellable, presentCashout(unknown).inProgress])
      .toEqual(["waiting", true, true]);
    expect(presentCashout({ ...withState("matched"), status: "unknown" }).stage).toBe("paying");
    expect(presentCashout({ ...withState("delivered"), status: "unknown" }).stage).toBe("paid");
  });
  test("a failed action reports failure only once its unlinked record is settled", () => {
    expect(presentCashout({ ...operation, status: "failed", cashout: undefined }).status).toBe("Cash-out failed");
    const unlinked = withState("awaiting-buyer", { depositId: null });
    const open = presentCashout({ ...unlinked, status: "failed" });
    expect([open.stage, open.status, open.inProgress, open.cancellable]).toEqual(["checking", "Checking status", true, false]);
    const settled = withState("submitted", { depositId: null, settledAt: "2026-09-15T13:00:00Z" });
    expect(presentCashout({ ...settled, status: "failed" }).stage).toBe("failed");
    expect(presentCashout({ ...unlinked, status: "unknown" }).stage).toBe("checking");
  });
  test("a linked provider failure remains failed regardless of the action status", () => {
    for (const status of ["confirmed", "failed", "unknown"] as const) {
      const view = presentCashout({ ...withState("failed"), status });
      expect([view.stage, view.status, view.cancellable, view.inProgress]).toEqual(["failed", "Cash-out failed", false, false]);
    }
  });
  test("partial paid, partial waiting and returned amounts name exact cash", () => {
    const partial = { filledAtomic: "30000000", remainingAtomic: "20000000" };
    expect(presentCashout(withState("awaiting-buyer", partial)).status).toBe("$30 paid · $20 waiting for a buyer");
    expect(presentCashout(withState("matched", partial)).status).toBe("$30 paid · Buyer paying you");
    expect(presentCashout(withState("delivered", { ...partial, remainingAtomic: "0", returnedAtomic: "20000000" })).status)
      .toBe("Paid $30 to Cash App · $20 returned");
  });
  test("withdrawal is folded as returning then returned, and pending/paid states cannot cancel", () => {
    const withdrawing = withState("awaiting-buyer", { withdrawing: true });
    expect(presentCashout(withdrawing, withdraw("pending")).stage).toBe("returning");
    expect(presentCashout(operation, withdraw("confirmed")).stage).toBe("returning");
    expect(presentCashout(withState("awaiting-buyer", { returnedAtomic: "50000000" }), withdraw("confirmed")).stage).toBe("returned");
    expect(presentCashout(operation).cancellable).toBe(true);
    for (const state of ["matched", "delivering", "delivered", "failed", "unknown"] as const)
      expect(presentCashout(withState(state)).cancellable).toBe(false);
    expect(presentCashout(withdrawing, withdraw("pending")).cancellable).toBe(false);
    expect(presentCashout(withdrawing, withdraw("unknown")).stage).toBe("returning");
    expect(presentCashout(withdrawing, withdraw("unknown")).cancellable).toBe(false);
    expect(presentCashout(operation, withdraw("failed")).cancellable).toBe(true);
    expect(presentCashout(withState("returned", { returnedAtomic: "50000000" }), withdraw("unknown")).stage).toBe("returned");
    expect(presentCashout(withState("awaiting-buyer", { depositId: null })).cancellable).toBe(false);
    expect(presentCashout(withState("awaiting-buyer", { withdrawable: false })).cancellable).toBe(false);
    expect(presentCashout(withState("awaiting-buyer", { remainingAtomic: "0" })).cancellable).toBe(false);
  });
  test("an abandoned unknown withdrawal restores waiting and Cancel only after server clears withdrawing", () => {
    const unknown = withdraw("unknown");
    const abandoned = presentCashout(withState("awaiting-buyer", { withdrawing: false }), unknown);
    expect([abandoned.stage, abandoned.cancellable]).toEqual(["waiting", true]);
    const inFlight = presentCashout(withState("awaiting-buyer", { withdrawing: true }), unknown);
    expect([inFlight.stage, inFlight.cancellable]).toEqual(["returning", false]);
  });
  test("delivered provider progress outranks both in-flight and unverified confirmed withdrawals", () => {
    expect(presentCashout(withState("delivered", { withdrawing: true }), withdraw("unknown")).stage).toBe("paid");
    expect(presentCashout(withState("delivered"), withdraw("confirmed")).stage).toBe("paid");
  });
  test("a confirmed withdrawal keeps returning until the returned amount is verified", () => {
    const partial = withState("awaiting-buyer", { filledAtomic: "30000000", remainingAtomic: "20000000" });
    const confirmed = {
      ...withdraw("confirmed"),
      action: { ...withdraw("confirmed").action, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "20000000", direction: "receive" as const }] },
    };
    const unverified = presentCashout(partial, confirmed);
    expect([unverified.stage, unverified.status, unverified.returned, unverified.inProgress]).toEqual(["returning", "Returning", "0", true]);
    expect(presentCashoutDetails(partial, confirmed).rows.some((row) => row.label === "Returned")).toBe(false);
    const verified = withState("awaiting-buyer", { filledAtomic: "35000000", remainingAtomic: "15000000", returnedAtomic: "15000000" });
    expect(presentCashout(verified, confirmed).status).toBe("Paid $35 to Cash App · $15 returned");
    const partialReceipt = withState("awaiting-buyer", { filledAtomic: "0", remainingAtomic: "50000000", returnedAtomic: "20000000" });
    const stillReturning = presentCashout(partialReceipt, confirmed);
    expect([stillReturning.stage, stillReturning.status, stillReturning.inProgress]).toEqual(["returning", "Returning", true]);
    expect(presentCashout(withState("delivered", { filledAtomic: "0", remainingAtomic: "0", returnedAtomic: "20000000" }), confirmed).stage).toBe("paid");
  });
  test("a confirmed but unverified withdrawal does not outrank delivered provider progress", () => {
    const metadata = { product: "cashout", operation: "withdraw", depositId: "ESCROW-1", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "20", minConversionRate: "1",
      intentAmountRange: { min: "1", max: "2" }, estimateAsOf: "", escrow: "0x0000000000000000000000000000000000000001" } as const;
    const older = { ...withdraw("failed"), updatedAt: "2026-09-15T12:01:00Z", action: { ...withdraw("failed").action, id: "w1", metadata } };
    const newer = { ...withdraw("confirmed"), updatedAt: "2026-09-15T12:02:00Z", action: { ...withdraw("confirmed").action, id: "w2", metadata } };
    const delivered = withState("delivered", { filledAtomic: "30000000", remainingAtomic: "20000000" });
    const linked = linkedCashoutWithdraw(delivered, [older, delivered, newer]);
    expect(linked?.action.id).toBe("w2");
    expect([presentCashout(delivered, linked).stage, presentCashout(delivered, linked).inProgress]).toEqual(["paid", false]);
    expect(linkedCashoutWithdraw(withState("delivered", { depositId: null }), [newer])).toBeUndefined();
  });
  test("a provider-returned order awaiting withdrawal finality keeps refreshing until it settles", () => {
    const unsettled = presentCashout(withState("returned", { remainingAtomic: "0", returnedAtomic: "50000000", withdrawable: false }));
    expect([unsettled.stage, unsettled.status, unsettled.inProgress, unsettled.refreshing]).toEqual(["returned", "Returned", false, true]);
    const settled = presentCashout(withState("returned", { remainingAtomic: "0", returnedAtomic: "50000000", withdrawable: false, settledAt: "2026-09-15T13:00:00Z" }));
    expect([settled.stage, settled.refreshing]).toEqual(["returned", false]);
    expect(presentCashout(withState("failed", { withdrawable: false })).refreshing).toBe(false);
  });
  test("an older unsettled withdrawal outranks a newer failed attempt so Cancel stays hidden", () => {
    const metadata = { product: "cashout", operation: "withdraw", depositId: "escrow-1", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "0", minConversionRate: "1",
      intentAmountRange: { min: "1", max: "2" }, estimateAsOf: "", escrow: "0x0000000000000000000000000000000000000001" } as const;
    const attempt = (id: string, status: RecentMoneyActionOperation["status"], updatedAt: string) =>
      ({ ...withdraw(status), updatedAt, action: { ...withdraw(status).action, id, metadata } });
    for (const live of ["pending", "unknown"] as const) {
      const older = attempt("w1", live, "2026-09-15T12:01:00Z");
      const newer = attempt("w2", "failed", "2026-09-15T12:02:00Z");
      const linked = linkedCashoutWithdraw(operation, [newer, operation, older]);
      expect(linked?.action.id).toBe("w1");
      expect(presentCashout(withState("awaiting-buyer", { withdrawing: true }), linked).cancellable).toBe(false);
    }
    const confirmed = attempt("w1", "confirmed", "2026-09-15T12:01:00Z");
    expect(linkedCashoutWithdraw(operation, [attempt("w2", "unknown", "2026-09-15T12:02:00Z"), confirmed])?.action.id).toBe("w1");
    expect(linkedCashoutWithdraw(operation, [confirmed, attempt("w2", "failed", "2026-09-15T12:02:00Z")])?.action.id).toBe("w1");
    expect(linkedCashoutWithdraw(operation, [attempt("w1", "failed", "2026-09-15T12:01:00Z"), attempt("w2", "failed", "2026-09-15T12:02:00Z")])?.action.id).toBe("w2");
  });
  test("details show a delivery estimate only while a buyer can still pay", () => {
    expect(presentCashoutDetails(operation).rows).toContainEqual({ label: "Estimated delivery", value: "About 60 min" });
    expect(presentCashoutDetails(withState("delivered")).rows.some((row) => row.label === "Estimated delivery")).toBe(false);
    expect(presentCashoutDetails(withState("matched")).rows).toContainEqual({ label: "Estimated delivery", value: "About 60 min" });
    const returning = presentCashoutDetails(withState("awaiting-buyer", { withdrawing: true }), withdraw("pending"));
    expect(returning.rows[0]).toEqual({ label: "Status", value: "Returning", statusTone: "pending" });
    expect(returning.rows.some((row) => row.label === "Estimated delivery")).toBe(false);
    expect(presentCashoutDetails(withState("unknown")).rows.some((row) => row.label === "Estimated delivery")).toBe(false);
  });
});
