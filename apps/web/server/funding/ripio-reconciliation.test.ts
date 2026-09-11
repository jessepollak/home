import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { RIPIO_ASSETS } from "@/shared/funding/ripio-contract";
import {
  homeCustomerKey,
  parseRipioWebhook,
  reconcileRipioOrder,
  verifyRipioWebhook,
  type DurableRipioOrder,
} from "./ripio-reconciliation";

const ORDER = "11111111-1111-4111-8111-111111111111";
const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;

function order(overrides: Partial<DurableRipioOrder> = {}): DurableRipioOrder {
  return {
    homeOrderId: "55555555-5555-4555-8555-555555555555",
    homeCustomerKey: "AR:home-user",
    country: "AR",
    customerId: "22222222-2222-4222-8222-222222222222",
    quoteId: "33333333-3333-4333-8333-333333333333",
    providerOrderId: ORDER,
    destination: DESTINATION,
    tokenAddress: RIPIO_ASSETS.AR.tokenAddress,
    expectedAmountAtomic: "2100000000000000000000",
    state: "awaiting-payment",
    providerStatus: "CREATED",
    providerTransactionHash: null,
    transferEvidence: null,
    updatedAt: "2026-09-11T18:00:00.000Z",
    ...overrides,
  };
}

describe("Ripio webhook and reconciliation contract", () => {
  test("verifies the HMAC over untouched raw bytes", () => {
    const rawBody = new TextEncoder().encode('{"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "status":"COMPLETED"}');
    const signingKey = "fixture-signing-key-32-bytes-long";
    const signature = createHmac("sha256", signingKey).update(rawBody).digest("hex");
    expect(verifyRipioWebhook({ rawBody, signature, signingKey })).toBe(true);
    const reparsed = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(rawBody))));
    expect(verifyRipioWebhook({ rawBody: reparsed, signature, signingKey })).toBe(false);
  });

  test("parses durable event and provider order IDs without retaining the raw body", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "ONRAMP_PAYMENT_RECEIVED", issueDatetime: "2026-09-11T18:01:00.000Z", transactionObject: { transactionId: ORDER } }));
    expect(parseRipioWebhook(raw)).toMatchObject({ providerOrderId: ORDER, status: "ONRAMP_PAYMENT_RECEIVED", occurredAt: "2026-09-11T18:01:00.000Z" });
    expect(parseRipioWebhook(raw)?.eventId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("handles late/out-of-order statuses and refund terminality", () => {
    const sent = reconcileRipioOrder({ order: order({ state: "sending" }), providerStatus: "PAYMENT_RECEIVED", providerTransactionHash: null, now: "2026-09-11T18:02:00.000Z" });
    expect(sent.state).toBe("sending");
    const refunded = reconcileRipioOrder({ order: sent, providerStatus: "REFUNDED", providerTransactionHash: null, now: "2026-09-11T18:03:00.000Z" });
    expect(refunded.state).toBe("refunded");
    expect(reconcileRipioOrder({ order: refunded, providerStatus: "COMPLETED", providerTransactionHash: TX_HASH, now: "2026-09-11T18:04:00.000Z" }).state).toBe("refunded");
  });

  test("requires provider GET hash plus exact Base transfer evidence before Received", () => {
    const completed = reconcileRipioOrder({ order: order(), providerStatus: "COMPLETED", providerTransactionHash: TX_HASH, now: "2026-09-11T18:05:00.000Z" });
    expect(completed.state).toBe("sent-unverified");
    const evidence = { chainId: 8453 as const, transactionHash: TX_HASH, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, destination: DESTINATION, amountAtomic: "2100000000000000000000", blockNumber: "51180068", confirmations: 2 };
    expect(reconcileRipioOrder({ order: completed, providerStatus: "COMPLETED", providerTransactionHash: TX_HASH, transferEvidence: evidence, minimumConfirmations: 2, now: "2026-09-11T18:06:00.000Z" }).state).toBe("received");
    expect(reconcileRipioOrder({ order: completed, providerStatus: "COMPLETED", providerTransactionHash: TX_HASH, transferEvidence: { ...evidence, destination: "0x2222222222222222222222222222222222222222" }, now: "2026-09-11T18:06:00.000Z" }).state).toBe("sent-unverified");
  });

  test("keeps stable Home customer mapping separate from wallet and order identifiers", () => {
    expect(homeCustomerKey({ subject: "home-user", country: "AR" })).toBe("AR:home-user");
  });
});
