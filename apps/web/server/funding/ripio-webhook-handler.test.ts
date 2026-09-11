import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { RIPIO_ASSETS } from "@/shared/funding/ripio-contract";
import type { RipioTransactionReference } from "./ripio-client";
import { createRipioWebhookHandler } from "./ripio-webhook-handler";
import type { DurableRipioOrder, RipioReconciliationStore, RipioVerifiedObservation } from "./ripio-reconciliation";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const HOME_ORDER = "44444444-4444-4444-8444-444444444444";
const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const signingKey = "fixture-signing-key-32-bytes-long";
function order(): DurableRipioOrder { return { homeOrderId:HOME_ORDER,homeCustomerKey:"AR:user",country:"AR",customerId:CUSTOMER,quoteId:QUOTE,providerOrderId:ORDER_ID,operationType:"ON_RAMP",fromCurrency:"ARS",toCurrency:"wARS",chain:"BASE",paymentMethodType:"bank_transfer",destination:DESTINATION,tokenAddress:RIPIO_ASSETS.AR.tokenAddress,tokenDecimals:18,expectedAmountAtomic:"2100000000000000000000",state:"sending",providerStatus:"SENDING",providerTransactionHash:null,latestRefundStatus:null,latestRefundRejectionReason:null,transferEvidence:null,version:1,updatedAt:"2026-09-11T18:00:00Z" }; }
function transaction(overrides: Partial<RipioTransactionReference> = {}): RipioTransactionReference { return { transactionId:ORDER_ID,customerId:CUSTOMER,quoteId:QUOTE,externalRef:HOME_ORDER,status:"COMPLETED",txnHash:TX_HASH,operationType:"ON_RAMP",fromCurrency:"ARS",toCurrency:"wARS",chain:"BASE",destination:DESTINATION,paymentMethodType:"bank_transfer",amount:"2100",latestRefund:null,...overrides }; }
function signedRequest(body: string, header = "Http-X-Wh-Signature-256") { return new Request("https://home.example/api/funding/ripio/webhook", { method:"POST",headers:{ [header]:createHmac("sha256",signingKey).update(body).digest("hex") },body }); }
function body() { return JSON.stringify({ eventType:"ONRAMP_CRYPTO_SENT",issueDatetime:"2026-09-11T18:01:00Z",transactionObject:{transactionId:ORDER_ID} }); }
function store(overrides: Partial<RipioReconciliationStore> = {}): RipioReconciliationStore { return { hasWebhookEvent:async()=>false,recordUnmatchedWebhook:async()=>true,getByProviderOrderId:async()=>order(),applyVerifiedObservation:async()=>"applied",listPendingInbox:async()=>[],resolveInbox:async()=>"pending",...overrides }; }

describe("Ripio webhook handler", () => {
  test("uses documented signature header, provider GET and atomic observation commit", async () => {
    const applied: RipioVerifiedObservation[] = [];
    const handler = createRipioWebhookHandler({ signingKey,store:store({applyVerifiedObservation:async(value)=>{applied.push(value);return "applied";}}),clientForCountry:()=>({getTransaction:async()=>transaction()} as never),findBaseTransferEvidence:async()=>({chainId:8453,transactionHash:TX_HASH,tokenAddress:RIPIO_ASSETS.AR.tokenAddress,destination:DESTINATION,amountAtomic:order().expectedAmountAtomic,blockNumber:"51180068",confirmations:1}) });
    expect((await handler(signedRequest(body()))).status).toBe(202);
    expect(applied).toHaveLength(1);
    expect((await handler(signedRequest(body(), "x-ripio-signature"))).status).toBe(401);
  });
  test("rechecks Base evidence for duplicate completion events while still sent-unverified", async () => {
    let evidenceReads = 0;
    let applies = 0;
    const pendingOrder = { ...order(), state: "sent-unverified" as const, providerTransactionHash: TX_HASH };
    const handler = createRipioWebhookHandler({
      signingKey,
      store: store({ hasWebhookEvent: async () => true, getByProviderOrderId: async () => pendingOrder, applyVerifiedObservation: async () => { applies += 1; return "duplicate"; } }),
      clientForCountry: () => ({ getTransaction: async () => transaction() } as never),
      findBaseTransferEvidence: async () => { evidenceReads += 1; return { chainId: 8453, transactionHash: TX_HASH, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, destination: DESTINATION, amountAtomic: order().expectedAmountAtomic, blockNumber: "51180068", confirmations: 1 }; },
    });
    expect((await handler(signedRequest(body()))).status).toBe(202);
    expect({ evidenceReads, applies }).toEqual({ evidenceReads: 1, applies: 1 });
  });

  test("rejects unrelated GET bindings before evidence or persistence", async () => {
    let evidenceReads=0,applies=0;
    const handler=createRipioWebhookHandler({signingKey,store:store({applyVerifiedObservation:async()=>{applies+=1;return "applied";}}),clientForCountry:()=>({getTransaction:async()=>transaction({customerId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"})} as never),findBaseTransferEvidence:async()=>{evidenceReads+=1;return null;}});
    expect((await handler(signedRequest(body()))).status).toBe(409);
    expect({evidenceReads,applies}).toEqual({evidenceReads:0,applies:0});
  });
  test("leaves failed atomic commits retryable instead of acknowledging a duplicate", async () => {
    let attempts=0;
    const handler=createRipioWebhookHandler({signingKey,store:store({applyVerifiedObservation:async()=>{attempts+=1;if(attempts===1)throw new Error("db unavailable");return "applied";}}),clientForCountry:()=>({getTransaction:async()=>transaction()} as never),findBaseTransferEvidence:async()=>null});
    await expect(handler(signedRequest(body()))).rejects.toThrow("db unavailable");
    expect((await handler(signedRequest(body()))).status).toBe(202);
    expect(attempts).toBe(2);
  });
  test("persists unmatched deposits in a retryable recovery inbox", async () => {
    let inbox=0;
    const handler=createRipioWebhookHandler({signingKey,store:store({getByProviderOrderId:async()=>null,recordUnmatchedWebhook:async()=>{inbox+=1;return true;}}),clientForCountry:()=>{throw new Error("unused");},findBaseTransferEvidence:async()=>null});
    const response=await handler(signedRequest(body()));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({matched:false,recovery:"pending"});
    expect(inbox).toBe(1);
  });
});
