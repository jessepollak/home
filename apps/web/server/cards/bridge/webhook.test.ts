import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readBridgeConfig } from "./config";
import { createBridgeWebhookProvider, createStripeWebhookProvider } from "./webhook";

const now = Date.parse("2026-09-24T12:00:00Z");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const secret = "whsec_synthetic_private_fixture";
const config = readBridgeConfig({ BRIDGE_ENABLED: "1", BRIDGE_MODE: "sandbox", BRIDGE_WEBHOOK_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
  BRIDGE_STRIPE_WEBHOOK_SECRET: secret, BRIDGE_PROGRAM_SPENDER: "0x65bf8b55EEDef53C094E40003a03390De744DF33" });
if (!config) throw new Error("Fixture config missing");
function bridge(rawEvent: object) {
  const raw = new TextEncoder().encode(JSON.stringify(rawEvent));
  const digest = createHash("sha256").update(`${now}.`).update(raw).digest();
  return { raw, headers: new Headers({ "x-webhook-signature": `t=${now},v0=${sign("RSA-SHA256", digest, privateKey).toString("base64")}` }) };
}
function stripe(type: string, object: object) {
  const timestamp = Math.floor(now / 1000);
  const raw = new TextEncoder().encode(JSON.stringify({ id: "evt_fixture", type, livemode: false, created: timestamp, data: { object } }));
  return { raw, headers: new Headers({ "stripe-signature": `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex")}` }) };
}

describe("Bridge documented event structure https://apidocs.bridge.xyz/platform/additional-information/webhooks/structure", () => {
  const provider = createBridgeWebhookProvider(config, () => now);
  test("customer KYC state transition preserves customer and Stripe cardholder IDs only", async () => {
    const delivery = bridge({ api_version: "v0", event_id: "wh_kyc_fixture", event_category: "customer", event_type: "customer.updated.status_transitioned",
      event_object_id: "c_fixture", event_created_at: "2026-09-24T11:59:00Z", event_object: { id: "c_fixture", stripe_cardholder_id: "ich_fixture", email: "PRIVATE", endorsements: [{ name: "cards", status: "approved" }] } });
    const result = await provider.verifyAndNormalize(delivery.raw, delivery.headers);
    expect(result).toEqual({ outcome: "accepted", observation: { provider: "bridge", mode: "sandbox", eventId: "wh_kyc_fixture",
      kind: "customer.updated.status_transitioned", occurredAt: "2026-09-24T11:59:00Z",
      externalIds: { customer: "c_fixture", cardholder: "ich_fixture", card: null, transaction: null } } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  test("KYC link requires customer ID; documented null ID cannot be associated with a customer", async () => {
    const payload = { api_version: "v0", event_id: "wh_kyclink_fixture", event_category: "kyc_link", event_type: "kyc_link.updated.status_transitioned",
      event_object_id: "kyclink_fixture", event_created_at: "2026-09-24T11:59:00Z", event_object: { id: "kyclink_fixture", customer_id: "customer_fixture", full_name: "PRIVATE" } };
    const valid = bridge(payload);
    expect((await provider.verifyAndNormalize(valid.raw, valid.headers)).outcome).toBe("accepted");
    const missing = bridge({ ...payload, event_object: { ...payload.event_object, customer_id: null } });
    expect((await provider.verifyAndNormalize(missing.raw, missing.headers)).outcome).toBe("rejected");
  });
  test("rejects noncanonical base64 and future delivery timestamp", async () => {
    const valid = bridge({ api_version: "v0", event_id: "wh_fixture", event_category: "customer", event_type: "customer.updated",
      event_object_id: "c_fixture", event_created_at: "2026-09-24T11:59:00Z", event_object: { id: "c_fixture" } });
    const invalid = new Headers(valid.headers);
    invalid.set("x-webhook-signature", `${invalid.get("x-webhook-signature")}= `);
    expect((await provider.verifyAndNormalize(valid.raw, invalid)).outcome).toBe("rejected");
    const future = new Headers(valid.headers);
    future.set("x-webhook-signature", future.get("x-webhook-signature")!.replace(String(now), String(now + 600_001)));
    expect((await provider.verifyAndNormalize(valid.raw, future)).outcome).toBe("rejected");
    const futureEvent = bridge({ api_version: "v0", event_id: "wh_future", event_category: "customer", event_type: "customer.updated",
      event_object_id: "c_fixture", event_created_at: new Date(now + 300_001).toISOString(), event_object: { id: "c_fixture" } });
    expect((await provider.verifyAndNormalize(futureEvent.raw, futureEvent.headers)).outcome).toBe("rejected");
  });
});

describe("Stripe Issuing events https://apidocs.bridge.xyz/platform/cards/overview/webhooks", () => {
  const provider = createStripeWebhookProvider(config, () => now);
  test("normalizes authorization, transaction and cardholder events by allowlisted ID", async () => {
    for (const [type, object, expected] of [
      ["issuing_authorization.updated", { object: "issuing.authorization", id: "iauth_fixture", card: "ic_fixture", cardholder: "ich_fixture" }, null],
      ["issuing_transaction.updated", { object: "issuing.transaction", id: "itrx_fixture", card: "ic_fixture", cardholder: "ich_fixture" }, "itrx_fixture"],
      ["issuing_cardholder.created", { object: "issuing.cardholder", id: "ich_fixture" }, null],
    ] as const) {
      const delivery = stripe(type, object);
      const result = await provider.verifyAndNormalize(delivery.raw, delivery.headers);
      expect(result.outcome).toBe("accepted");
      if (result.outcome === "accepted") expect(result.observation.externalIds.transaction).toBe(expected);
    }
  });
  test("accepts an expanded Issuing card and nullable transaction cardholder without retaining card fields", async () => {
    const delivery = stripe("issuing_transaction.created", { object: "issuing.transaction", id: "itrx_fixture", cardholder: null,
      card: { object: "issuing.card", id: "ic_fixture", number: "PRIVATE" } });
    const result = await provider.verifyAndNormalize(delivery.raw, delivery.headers);
    expect(result).toMatchObject({ outcome: "accepted", observation: { externalIds: {
      cardholder: null, card: "ic_fixture", transaction: "itrx_fixture", customer: null,
    } } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  test("rejects live-mode event with sandbox secret even when correctly signed", async () => {
    const timestamp = Math.floor(now / 1000);
    const raw = new TextEncoder().encode(JSON.stringify({ id: "evt_live_fixture", type: "issuing_authorization.created", livemode: true, created: timestamp,
      data: { object: { object: "issuing.authorization", id: "iauth_fixture", card: "ic_fixture", cardholder: "ich_fixture" } } }));
    const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex");
    expect((await provider.verifyAndNormalize(raw, new Headers({ "stripe-signature": `t=${timestamp},v1=${signature}` }))).outcome).toBe("rejected");
    const future = new TextEncoder().encode(JSON.stringify({ id: "evt_future_fixture", type: "issuing_authorization.created", livemode: false,
      created: timestamp + 301, data: { object: { object: "issuing.authorization", id: "iauth_fixture", card: "ic_fixture" } } }));
    const futureSignature = createHmac("sha256", secret).update(`${timestamp}.`).update(future).digest("hex");
    expect((await provider.verifyAndNormalize(future, new Headers({ "stripe-signature": `t=${timestamp},v1=${futureSignature}` }))).outcome).toBe("rejected");
  });
  test("rejects unsupported webhook kind and malformed Stripe signature", async () => {
    const delivery = stripe("charge.succeeded", { object: "charge", id: "ch_fixture" });
    expect((await provider.verifyAndNormalize(delivery.raw, delivery.headers)).outcome).toBe("rejected");
    const invalid = stripe("issuing_authorization.created", { object: "issuing.authorization", id: "iauth_fixture", card: "ic_fixture", cardholder: "ich_fixture" });
    invalid.headers.set("stripe-signature", `t=${Math.floor(now / 1000)},v1=${"a".repeat(64)}`);
    expect((await provider.verifyAndNormalize(invalid.raw, invalid.headers)).outcome).toBe("rejected");
  });
});
