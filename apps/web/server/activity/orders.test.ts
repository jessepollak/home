import { describe, expect, test } from "bun:test";
import type { ActivityOrderStatus } from "@/shared/activity/contract-orders";
import type { FundingOrder } from "@/server/funding/core/store";
import type { CashoutOrderRow } from "@/server/actions/store";
import { presentFundingOrder, presentCashoutOrder } from "./orders";

const now = new Date("2026-09-12T12:00:00.000Z");
const funding: FundingOrder = {
  id: "funding-1", owner: { subject: "owner", accountProvider: "base-account" }, destination: "0x1111111111111111111111111111111111111111",
  providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000",
  intentDigest: "secret-intent", quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2026-09-12T14:00:00.000Z" },
  quoteToken: "secret-token", customerRef: "secret-customer", sandbox: false, state: "awaiting-payment",
  creationBlock: "100", providerOrderId: "secret-provider-order", expectedTokenAmountAtomic: "1999999", fees: [],
  expiresAt: "2026-09-12T13:00:00.000Z", instructions: { kind: "qr", scheme: "qris", payload: "secret-payload", amount: "20000", currency: "IDR" },
  providerStatus: "secret-status", providerTransactionHash: `0x${"2".repeat(64)}`, transactionHash: null, logIndex: null, version: 1,
  createdAt: "2026-09-12T10:00:00.000Z", updatedAt: "2026-09-12T11:00:00.000Z",
  checkedAt: null, abandonReason: null,
};
const cashout: CashoutOrderRow = {
  action_id: "action-1", owner_key: "private-owner", provider_id: "peer", environment: "production", region: "US", deposit_id: "deposit-1", deposit_proven: true,
  state: "submitted", platform: "cashapp", platform_label: "Cash App", amount_atomic: "2000000", filled_atomic: "0", returned_atomic: "0",
  remaining_atomic: "2000000", withdrawable: false, eta_seconds: 30,
  created_at: new Date("2026-09-12T10:00:00.000Z"), updated_at: "2026-09-12T11:00:00.000Z", refreshed_at: null, settled_at: null,
};

describe("activity order presenters", () => {
  test("maps every funding state and differentiates sandbox receipt, expiry and cleared orders", () => {
    const cases: Array<[FundingOrder["state"], boolean, "ambiguous" | "waiting-customer" | "waiting-provider" | "waiting-chain" | "confirmed" | "failed" | "expired" | "refunded", string]> = [
      ["reserving", false, "ambiguous", "unconfirmed"], ["unknown", false, "ambiguous", "unconfirmed"],
      ["dispatch-ambiguous", false, "ambiguous", "unconfirmed"], ["awaiting-payment", false, "waiting-customer", "awaiting-payment"],
      ["payment-received", false, "waiting-provider", "provider-processing"], ["settling", false, "waiting-provider", "provider-processing"],
      ["sent", false, "waiting-chain", "arriving"], ["sent-unverified", false, "waiting-chain", "arriving"],
      ["sent", true, "confirmed", "received"], ["sent-unverified", true, "confirmed", "received"],
      ["received", false, "confirmed", "received"], ["expired", false, "expired", "expired"],
      ["cancelled", false, "failed", "cancelled"], ["failed", false, "failed", "failed"], ["refunded", false, "refunded", "refunded"],
    ];
    for (const [state, sandbox, status, stage] of cases) {
      expect(presentFundingOrder({ ...funding, state, sandbox }, now, false)).toMatchObject({ status, stage, resumable: false });
    }
    expect(presentFundingOrder({ ...funding, expiresAt: now.toISOString() }, now, false)).toMatchObject({ status: "expired", stage: "expired" });
    expect(presentFundingOrder({ ...funding, expiresAt: "invalid" }, now, false)).toMatchObject({ status: "waiting-customer" });
    expect(presentFundingOrder({ ...funding, state: "cancelled", providerOrderId: null }, now, false)).toMatchObject({ status: "failed", stage: "cleared" });
    expect(presentFundingOrder({ ...funding, state: "dispatch-ambiguous" }, now, false)?.clearableAt).toBe("2026-09-13T14:00:00.000Z");
    expect(presentFundingOrder({ ...funding, state: "dispatch-ambiguous", updatedAt: "invalid" }, now, false)?.clearableAt).toBeNull();
  });

  test("presents owner abandonment and checkout timeout without provider cancellation", () => {
    expect(presentFundingOrder({ ...funding, state: "abandoned", abandonReason: "owner", instructions: null }, now, false)).toMatchObject({ status: "failed", stage: "cancelled", abandonReason: "owner", instruction: null, movedAt: funding.updatedAt });
    expect(presentFundingOrder({ ...funding, state: "abandoned", abandonReason: "timed-out", instructions: null }, now, false)).toMatchObject({ status: "expired", stage: "expired", abandonReason: "timed-out" });
    expect(presentFundingOrder({ ...funding, expiresAt: null, createdAt: "2026-09-11T12:00:00.000Z" }, now, false)).toMatchObject({ status: "expired", stage: "expired", movedAt: "2026-09-11T12:00:00.000Z" });
    for (const state of ["reserving", "awaiting-payment", "unknown", "dispatch-ambiguous"] as const) {
      expect(presentFundingOrder({ ...funding, state }, now, false)).toMatchObject({ createdAt: funding.createdAt, updatedAt: funding.updatedAt, movedAt: funding.createdAt });
    }
  });

  test("a terminal provider report drops the Home-local abandonment reason", () => {
    const expired = presentFundingOrder({ ...funding, state: "expired", abandonReason: "timed-out", instructions: null }, now, false);
    expect(expired).toMatchObject({ status: "expired", stage: "expired" });
    expect(expired).not.toHaveProperty("abandonReason");
    const cancelled = presentFundingOrder({ ...funding, state: "cancelled", abandonReason: "owner", instructions: null }, now, false);
    expect(cancelled).toMatchObject({ status: "failed", stage: "cancelled" });
    expect(cancelled).not.toHaveProperty("abandonReason");
  });

  test("resolves manifest labels, asset details, verified hash and excludes provider secrets", () => {
    const presented = presentFundingOrder(funding, now, true)!;
    expect(presented).toMatchObject({ providerName: "IDRX", paymentMethodLabel: "QRIS", fiatCurrency: "IDR",
      asset: { id: "base:idrx", symbol: "IDRX", decimals: 2 }, tokenAmountAtomic: "1999999", instruction: "qr", resumable: true, transactionHash: null, logIndex: null });
    expect(presentFundingOrder({ ...funding, transactionHash: `0x${"3".repeat(64)}`, logIndex: 12 }, now, false))
      .toMatchObject({ transactionHash: `0x${"3".repeat(64)}`, logIndex: "12" });
    const fallback = presentFundingOrder({ ...funding, providerId: "unknown", paymentMethod: "unlisted", expectedTokenAmountAtomic: null }, now, false)!;
    expect(fallback).toMatchObject({ providerName: "unknown", paymentMethodLabel: "unlisted", fiatCurrency: "IDR", tokenAmountAtomic: "2000000" });
    expect(presentFundingOrder({ ...funding, assetId: "missing" }, now, false)).toBeNull();
    for (const field of ["instructions", "quote", "quoteToken", "providerStatus", "providerOrderId", "customerRef", "destination", "owner", "providerTransactionHash"]) {
      expect(presented).not.toHaveProperty(field);
    }
    expect(JSON.stringify(presented)).not.toContain("secret-");
  });

  test("canonicalizes a mixed-case stored receipt hash and drops a malformed one", () => {
    expect(String(presentFundingOrder({ ...funding, transactionHash: `0x${"Ab".repeat(32)}` }, now, false)?.transactionHash)).toBe(`0x${"ab".repeat(32)}`);
    for (const hash of ["0x1234", `0x${"zz".repeat(32)}`] as const) {
      expect(presentFundingOrder({ ...funding, transactionHash: hash }, now, false)).toBeNull();
    }
  });

  test("maps every cash-out state and returned-funds branches", () => {
    const cases: Array<[CashoutOrderRow["state"], ActivityOrderStatus]> = [
      ["submitted", "waiting-provider"], ["awaiting-buyer", "waiting-provider"], ["matched", "waiting-provider"],
      ["delivering", "waiting-provider"], ["delivered", "confirmed"], ["returned", "waiting-chain"],
      ["failed", "failed"], ["unknown", "ambiguous"],
    ];
    for (const [state, status] of cases) expect(presentCashoutOrder({ ...cashout, state }).status).toBe(status);
    expect(presentCashoutOrder({ ...cashout, state: "returned", withdrawable: true }).status).toBe("reversed");
    expect(presentCashoutOrder({ ...cashout, state: "returned", withdrawable: true, remaining_atomic: "0" }).status).toBe("waiting-chain");
    expect(presentCashoutOrder({ ...cashout, state: "returned", settled_at: now, withdrawable: true }).status).toBe("refunded");
    expect(presentCashoutOrder({ ...cashout, state: "failed", withdrawable: true }).status).toBe("reversed");
    expect(presentCashoutOrder({ ...cashout, state: "failed", withdrawable: true, settled_at: now }).status).toBe("failed");
    expect(presentCashoutOrder(cashout)).toMatchObject({ id: "action-1", orderId: "deposit-1", decimals: 6, providerName: "Peer",
      createdAt: "2026-09-12T10:00:00.000Z", updatedAt: "2026-09-12T11:00:00.000Z" });
    expect(presentCashoutOrder({ ...cashout, provider_id: "unknown" }).providerName).toBe("unknown");
    for (const field of ["owner_key", "environment", "deposit_proven", "eta_seconds", "refreshed_at"]) expect(presentCashoutOrder(cashout)).not.toHaveProperty(field);
  });
});
