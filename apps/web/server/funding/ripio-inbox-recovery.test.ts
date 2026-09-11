import { describe, expect, test } from "bun:test";
import type { RipioTransactionReference } from "./ripio-client";
import { reconcilePendingRipioInbox } from "./ripio-inbox-recovery";
import type { RipioReconciliationStore } from "./ripio-reconciliation";

const ORDER = "11111111-1111-4111-8111-111111111111";
const transaction = { transactionId: ORDER, customerId: "22222222-2222-4222-8222-222222222222", quoteId: "33333333-3333-4333-8333-333333333333", externalRef: "44444444-4444-4444-8444-444444444444", status: "CANCELLED", txnHash: null, operationType: "ON_RAMP", fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", destination: "0x1111111111111111111111111111111111111111", paymentMethodType: "bank_transfer", amount: "2100", latestRefund: { status: "REJECTED", rejectionReason: "destination unavailable" } } satisfies RipioTransactionReference;

describe("Ripio unmatched inbox recovery", () => {
  test("reconciles exactly one country-scoped GET and retains latest refund outcome", async () => {
    const resolved: unknown[] = [];
    const store = { listPendingInbox: async () => [{ eventId: "event", providerOrderId: ORDER }], resolveInbox: async (value: unknown) => { resolved.push(value); return "applied" as const; }, hasWebhookEvent: async()=>false, recordUnmatchedWebhook:async()=>true, getByProviderOrderId:async()=>null, applyVerifiedObservation:async()=>"unmatched" as const } satisfies RipioReconciliationStore;
    const result = await reconcilePendingRipioInbox({ store, clientForCountry: (country) => ({ getTransaction: async () => { if (country === "CO") throw new Error("not found"); return transaction; } } as never), now: () => "2026-09-11T20:00:00Z" });
    expect(result).toEqual({ reconciled: 1, stillPending: 0 });
    expect(resolved[0]).toMatchObject({ country: "AR", transaction: { latestRefund: { status: "REJECTED" } } });
  });

  test("leaves ambiguous or unavailable provider matches retryable", async () => {
    let resolved = 0;
    const store = { listPendingInbox: async () => [{ eventId: "event", providerOrderId: ORDER }], resolveInbox: async () => { resolved += 1; return "pending" as const; }, hasWebhookEvent: async()=>false, recordUnmatchedWebhook:async()=>true, getByProviderOrderId:async()=>null, applyVerifiedObservation:async()=>"unmatched" as const } satisfies RipioReconciliationStore;
    const result = await reconcilePendingRipioInbox({ store, clientForCountry: () => ({ getTransaction: async () => transaction } as never) });
    expect(result).toEqual({ reconciled: 0, stillPending: 1 });
    expect(resolved).toBe(0);
  });
});
