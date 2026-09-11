import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { RIPIO_ASSETS } from "@/shared/funding/ripio-contract";
import type { RipioTransactionReference } from "./ripio-client";
import { homeCustomerKey, parseRipioWebhook, reconcileRipioOrder, transactionMatchesOrder, verifyRipioWebhook, type DurableRipioOrder } from "./ripio-reconciliation";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const HOME_ORDER = "44444444-4444-4444-8444-444444444444";
const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;

function order(overrides: Partial<DurableRipioOrder> = {}): DurableRipioOrder {
  return { homeOrderId: HOME_ORDER, homeCustomerKey: "AR:home-user", country: "AR", customerId: CUSTOMER, quoteId: QUOTE, providerOrderId: ORDER_ID, operationType: "ON_RAMP", fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, tokenDecimals: 18, expectedAmountAtomic: "2100000000000000000000", state: "awaiting-payment", providerStatus: "CREATED", providerTransactionHash: null, latestRefundStatus: null, latestRefundRejectionReason: null, transferEvidence: null, version: 1, updatedAt: "2026-09-11T18:00:00.000Z", ...overrides };
}
function transaction(overrides: Partial<RipioTransactionReference> = {}): RipioTransactionReference {
  return { transactionId: ORDER_ID, customerId: CUSTOMER, quoteId: QUOTE, externalRef: HOME_ORDER, status: "CREATED", txnHash: null, operationType: "ON_RAMP", fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", destination: DESTINATION, paymentMethodType: "bank_transfer", amount: "2100", latestRefund: null, ...overrides };
}

describe("Ripio webhook and reconciliation contract", () => {
  test("verifies HMAC over untouched raw bytes", () => {
    const rawBody = new TextEncoder().encode('{"eventType":"ONRAMP_CRYPTO_SENT", "issueDatetime":"2026-09-11T18:00:00Z","transactionObject":{"transactionId":"11111111-1111-4111-8111-111111111111"}}');
    const signingKey = "fixture-signing-key-32-bytes-long";
    const signature = createHmac("sha256", signingKey).update(rawBody).digest("hex");
    expect(verifyRipioWebhook({ rawBody, signature, signingKey })).toBe(true);
    const reparsed = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(rawBody))));
    expect(verifyRipioWebhook({ rawBody: reparsed, signature, signingKey })).toBe(false);
  });
  test("parses durable event identity", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "ONRAMP_PAYMENT_RECEIVED", issueDatetime: "2026-09-11T18:01:00.000Z", transactionObject: { transactionId: ORDER_ID } }));
    expect(parseRipioWebhook(raw)).toMatchObject({ providerOrderId: ORDER_ID, status: "ONRAMP_PAYMENT_RECEIVED" });
  });
  test("rejects every persisted identity, operation, asset, network, destination, rail and amount mismatch", () => {
    expect(transactionMatchesOrder(order(), transaction())).toBe(true);
    for (const mismatch of [
      { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { quoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { externalRef: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { operationType: "OFF_RAMP" }, { fromCurrency: "COP" },
      { toCurrency: "wCOP" }, { chain: "ETHEREUM" }, { destination: "0x2222222222222222222222222222222222222222" },
      { paymentMethodType: "breb" }, { amount: "2101" },
    ]) expect(transactionMatchesOrder(order(), transaction(mismatch as Partial<RipioTransactionReference>))).toBe(false);
  });
  test("preserves terminals and explicitly tracks cancellation/refund progress", () => {
    expect(reconcileRipioOrder({ order: order({ state: "cancelled" }), transaction: transaction({ status: "CREATED" }), now: "2026-09-11T18:02:00Z" }).state).toBe("cancelled");
    expect(reconcileRipioOrder({ order: order({ state: "payment-received" }), transaction: transaction({ status: "CANCELLED" }), now: "2026-09-11T18:02:00Z" }).state).toBe("cancelled");
    expect(reconcileRipioOrder({ order: order({ state: "cancelled" }), transaction: transaction({ status: "CANCELLED", latestRefund: { status: "PENDING", rejectionReason: null } }), now: "2026-09-11T18:02:00Z" }).state).toBe("refund-pending");
    expect(reconcileRipioOrder({ order: order({ state: "refund-pending" }), transaction: transaction({ status: "CANCELLED", latestRefund: { status: "REJECTED", rejectionReason: "bank rejected" } }), now: "2026-09-11T18:02:00Z" }).state).toBe("refund-rejected");
    expect(reconcileRipioOrder({ order: order({ state: "refunded" }), transaction: transaction({ status: "SENDING" }), now: "2026-09-11T18:02:00Z" }).state).toBe("refunded");
  });
  test("never downgrades Received and requires exact Base evidence to enter it", () => {
    const completed = reconcileRipioOrder({ order: order(), transaction: transaction({ status: "COMPLETED", txnHash: TX_HASH }), now: "2026-09-11T18:05:00Z" });
    expect(completed.state).toBe("sent-unverified");
    const evidence = { chainId: 8453 as const, transactionHash: TX_HASH, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, destination: DESTINATION, amountAtomic: order().expectedAmountAtomic, blockNumber: "51180068", confirmations: 2 };
    const received = reconcileRipioOrder({ order: completed, transaction: transaction({ status: "COMPLETED", txnHash: TX_HASH }), transferEvidence: evidence, minimumConfirmations: 2, now: "2026-09-11T18:06:00Z" });
    expect(received.state).toBe("received");
    expect(reconcileRipioOrder({ order: received, transaction: transaction({ status: "SENDING", txnHash: null }), now: "2026-09-11T18:07:00Z" }).state).toBe("received");
  });
  test("keeps stable Home customer mapping separate from orders", () => expect(homeCustomerKey({ subject: "home-user", country: "AR" })).toBe("AR:home-user"));
});
