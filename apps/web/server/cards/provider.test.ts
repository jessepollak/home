import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readImmersveConfig } from "./immersve/config";
import { createImmersveWebhookHandler } from "./immersve/webhook";
import { readBridgeConfig } from "./bridge/config";
import { createBridgeWebhookProvider, createStripeWebhookProvider } from "./bridge/webhook";
import { createCardWebhookHandler, type CardObservation, type CardProvider } from "./provider";

const now = Date.parse("2026-09-24T12:00:00Z");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const stripeSecret = "whsec_synthetic_private_fixture";
const bridge = readBridgeConfig({ BRIDGE_ENABLED: "1", BRIDGE_MODE: "sandbox", BRIDGE_WEBHOOK_PUBLIC_KEY: pem,
  BRIDGE_STRIPE_WEBHOOK_SECRET: stripeSecret, BRIDGE_PROGRAM_SPENDER: "0x65bf8b55EEDef53C094E40003a03390De744DF33" });
const immersve = readImmersveConfig({ IMMERSVE_ENABLED: "1", IMMERSVE_MODE: "sandbox", IMMERSVE_API_KEY: "fixture-key", IMMERSVE_API_SECRET: "fixture-secret",
  IMMERSVE_PARTNER_ACCOUNT_ID: "a".repeat(32), IMMERSVE_CLIENT_APPLICATION_ID: "b".repeat(32), IMMERSVE_CARD_PROGRAM_ID: "c".repeat(32),
  IMMERSVE_FUNDING_CHANNEL_ID: "d".repeat(32), IMMERSVE_FUNDS_STORAGE_ADDRESS: "0x1111111111111111111111111111111111111111",
  IMMERSVE_FUNDING_TYPE: "base-sepolia-usdc-universal-evm" });
if (!bridge || !immersve) throw new Error("Fixture configuration unavailable");
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256" };
type Delivery = { raw: Uint8Array; headers: Headers; topic?: string };
const encode = (value: object) => new TextEncoder().encode(JSON.stringify(value));

function immersveDelivery(createdAt = new Date(now).toISOString()): Delivery {
  const raw = encode({ messageId: "message_fixture", topic: "payment-updated", deliveryAttempt: 1, keyId: "fixture", issuer: "test.immersve.com", createdAt,
    payload: { payment: { id: "payment_fixture", cardholder: { id: "owner_fixture" }, card: { id: "card_fixture" }, pan: "PRIVATE" } } });
  return { raw, topic: "payment-updated", headers: new Headers({ "x-delivery-id": "message_fixture:1", "x-key-id": "fixture",
    "x-signature": sign("RSA-SHA256", Buffer.concat([Buffer.from("message_fixture:1:fixture:"), raw]), privateKey).toString("base64") }) };
}
function bridgeDelivery(timestamp = now): Delivery {
  const raw = encode({ api_version: "v0", event_id: "wh_fixture", event_category: "customer", event_type: "customer.updated", event_object_id: "customer_fixture",
    event_created_at: "2026-09-24T11:59:00Z", event_object: { id: "customer_fixture", stripe_cardholder_id: "ich_fixture", name: "PRIVATE" } });
  const digest = createHash("sha256").update(String(timestamp)).update(".").update(raw).digest();
  return { raw, headers: new Headers({ "x-webhook-signature": `t=${timestamp},v0=${sign("RSA-SHA256", digest, privateKey).toString("base64")}` }) };
}
function stripeDelivery(timestamp = Math.floor(now / 1000)): Delivery {
  const raw = encode({ id: "evt_fixture", type: "issuing_authorization.created", livemode: false, created: timestamp, data: { object: {
    object: "issuing.authorization", id: "iauth_fixture", card: "ic_fixture", cardholder: "ich_fixture", number: "PRIVATE" } } });
  const v1 = createHmac("sha256", stripeSecret).update(`${timestamp}.`).update(raw).digest("hex");
  return { raw, headers: new Headers({ "stripe-signature": `t=${timestamp},v1=${"f".repeat(64)},v1=${v1}` }) };
}
const adapters: { name: string; make(): CardProvider; delivery(): Delivery; staleDelivery(): Delivery; disabled(): boolean; expected: CardObservation }[] = [
  { name: "Immersve", make: () => createImmersveWebhookHandler({ config: immersve, client: { getJwks: async () => ({ keys: [jwk] }) }, store: { insert: async () => true }, now: () => now }).provider,
    delivery: immersveDelivery, staleDelivery: () => immersveDelivery(new Date(now - 31 * 24 * 60 * 60_000).toISOString()), disabled: () => readImmersveConfig({ IMMERSVE_ENABLED: "" }) === null,
    expected: { provider: "immersve", mode: "sandbox", eventId: "message_fixture", kind: "payment-updated", occurredAt: new Date(now).toISOString(),
      externalIds: { cardholder: "owner_fixture", card: "card_fixture", transaction: "payment_fixture", customer: null } } },
  { name: "Bridge (https://apidocs.bridge.xyz/platform/additional-information/webhooks/signature)", make: () => createBridgeWebhookProvider(bridge, () => now),
    delivery: bridgeDelivery, staleDelivery: () => bridgeDelivery(now - 600_001), disabled: () => readBridgeConfig({ BRIDGE_ENABLED: "" }) === null,
    expected: { provider: "bridge", mode: "sandbox", eventId: "wh_fixture", kind: "customer.updated", occurredAt: "2026-09-24T11:59:00Z",
      externalIds: { cardholder: "ich_fixture", card: null, transaction: null, customer: "customer_fixture" } } },
  { name: "Stripe (https://docs.stripe.com/webhooks)", make: () => createStripeWebhookProvider(bridge, () => now),
    delivery: stripeDelivery, staleDelivery: () => stripeDelivery(Math.floor(now / 1000) - 301), disabled: () => readBridgeConfig({ BRIDGE_ENABLED: "" }) === null,
    expected: { provider: "bridge", mode: "sandbox", eventId: "stripe:evt_fixture", kind: "issuing_authorization.created", occurredAt: new Date(now).toISOString(),
      externalIds: { cardholder: "ich_fixture", card: "ic_fixture", transaction: null, customer: null } } },
];

for (const adapter of adapters) describe(`${adapter.name} provider seam`, () => {
  test("disabled config is inert", () => { expect(adapter.disabled()).toBe(true); });
  test("verifies and normalizes only allowlisted IDs; dedupes by provider, mode, eventId", async () => {
    const provider = adapter.make();
    const stored = new Map<string, CardObservation>();
    const handler = createCardWebhookHandler(provider, { insert: async (event) => {
      const key = `${event.provider}/${event.mode}/${event.eventId}`;
      if (stored.has(key)) return false;
      stored.set(key, event); return true;
    } });
    const delivery = adapter.delivery();
    expect(await handler(delivery.raw, delivery.headers, delivery.topic)).toBe("accepted");
    expect(await handler(delivery.raw, delivery.headers, delivery.topic)).toBe("accepted");
    expect([...stored.values()]).toEqual([adapter.expected]);
    expect(JSON.stringify([...stored.values()])).not.toContain("PRIVATE");
    expect(["deposit", "allowance-pull"]).toContain(provider.fundingStrategy);
  });
  test("rejects bad signature and stale replay", async () => {
    const provider = adapter.make();
    const delivery = adapter.delivery();
    expect((await provider.verifyAndNormalize(new Uint8Array([...delivery.raw, 32]), delivery.headers, delivery.topic)).outcome).toBe("rejected");
    const stale = adapter.staleDelivery();
    expect((await provider.verifyAndNormalize(stale.raw, stale.headers, stale.topic)).outcome).toBe("rejected");
  });
  test("transient store failure is unavailable", async () => {
    const provider = adapter.make();
    const handler = createCardWebhookHandler(provider, { insert: async () => { throw new Error("offline fixture"); } });
    const delivery = adapter.delivery();
    expect(await handler(delivery.raw, delivery.headers, delivery.topic)).toBe("unavailable");
  });
});
