import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { RIPIO_ASSETS } from "@/shared/funding/ripio-contract";
import { createRipioWebhookHandler } from "./ripio-webhook-handler";
import type { DurableRipioOrder, RipioWebhookEvent } from "./ripio-reconciliation";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const signingKey = "fixture-signing-key-32-bytes-long";

function order(): DurableRipioOrder {
  return { homeOrderId: "55555555-5555-4555-8555-555555555555", homeCustomerKey: "AR:user", country: "AR", customerId: "22222222-2222-4222-8222-222222222222", quoteId: "33333333-3333-4333-8333-333333333333", providerOrderId: ORDER_ID, destination: DESTINATION, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, expectedAmountAtomic: "2100000000000000000000", state: "sending", providerStatus: "SENDING", providerTransactionHash: null, transferEvidence: null, updatedAt: "2026-09-11T18:00:00.000Z" };
}

function request(body: string, signature?: string) {
  return new Request("https://home.example/api/funding/ripio/webhook", { method: "POST", headers: signature ? { "x-ripio-signature": signature } : {}, body });
}

describe("Ripio webhook handler", () => {
  test("authenticates raw bytes, dedupes durably, reconciles by provider GET, and verifies Base receipt", async () => {
    const body = JSON.stringify({ eventType: "ONRAMP_CRYPTO_SENT", issueDatetime: "2026-09-11T18:01:00.000Z", transactionObject: { transactionId: ORDER_ID } });
    const signature = createHmac("sha256", signingKey).update(body).digest("hex");
    const events = new Set<string>();
    const saved: DurableRipioOrder[] = [];
    let gets = 0;
    const handler = createRipioWebhookHandler({
      signingKey,
      store: {
        hasWebhookEvent: async (eventId) => events.has(eventId),
        recordWebhookEvent: async (event: RipioWebhookEvent) => events.has(event.eventId) ? false : (events.add(event.eventId), true),
        getByProviderOrderId: async () => order(),
        saveReconciledOrder: async (value) => { saved.push(value); },
      },
      clientForCountry: () => ({ getTransaction: async () => { gets += 1; return { transactionId: ORDER_ID, customerId: "22222222-2222-4222-8222-222222222222", quoteId: "33333333-3333-4333-8333-333333333333", externalRef: "44444444-4444-4444-8444-444444444444", status: "COMPLETED", txnHash: TX_HASH }; } } as never),
      findBaseTransferEvidence: async () => ({ chainId: 8453, transactionHash: TX_HASH, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, destination: DESTINATION, amountAtomic: "2100000000000000000000", blockNumber: "51180068", confirmations: 1 }),
      now: () => "2026-09-11T18:02:00.000Z",
    });
    expect((await handler(request(body, signature))).status).toBe(202);
    expect(saved[0]?.state).toBe("received");
    expect((await handler(request(body, signature))).status).toBe(202);
    expect(saved).toHaveLength(1);
    expect(gets).toBe(1);
  });

  test("rejects invalid signatures before parsing or provider access", async () => {
    let reads = 0;
    const handler = createRipioWebhookHandler({ signingKey, store: { hasWebhookEvent: async () => false, recordWebhookEvent: async () => false, getByProviderOrderId: async () => { reads += 1; return null; }, saveReconciledOrder: async () => {} }, clientForCountry: () => { throw new Error("unused"); }, findBaseTransferEvidence: async () => null });
    expect((await handler(request("{}", "00".repeat(32)))).status).toBe(401);
    expect(reads).toBe(0);
  });
});
