import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readImmersveConfig } from "./config";
import { createImmersveWebhookHandler, isImmersveWebhookTopic } from "./webhook";
import type { CardEvent } from "./store";

const NOW = Date.parse("2026-09-24T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: unrelatedPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const configured = readImmersveConfig({
  IMMERSVE_ENABLED: "1", IMMERSVE_MODE: "sandbox", IMMERSVE_API_KEY: "synthetic-key", IMMERSVE_API_SECRET: "synthetic-secret",
  IMMERSVE_PARTNER_ACCOUNT_ID: "a".repeat(32), IMMERSVE_CLIENT_APPLICATION_ID: "b".repeat(32), IMMERSVE_CARD_PROGRAM_ID: "c".repeat(32),
  IMMERSVE_FUNDING_CHANNEL_ID: "d".repeat(32), IMMERSVE_FUNDS_STORAGE_ADDRESS: "0x1111111111111111111111111111111111111111",
  IMMERSVE_FUNDING_TYPE: "base-sepolia-usdc-universal-evm",
});
if (!configured) throw new Error("Missing synthetic config");
const config = configured;
const key = { ...publicKey.export({ format: "jwk" }), kid: "first", alg: "RS256", use: "sig" };
const envelope = {
  messageId: "event-1", topic: "payment-updated", deliveryAttempt: 1, keyId: "first", issuer: "test.immersve.com",
  createdAt: "2026-09-24T11:59:00.000Z",
  payload: { payment: { id: "payment-1", cardholder: { id: "owner-1" }, card: { id: "card-1" }, amount: "private-data" } },
};
function delivery(body: string, messageId = "event-1", kid = "first") {
  const raw = new TextEncoder().encode(body);
  const deliveryId = `${messageId}:1`;
  const signature = sign("RSA-SHA256", Buffer.concat([Buffer.from(`${deliveryId}:${kid}:`), raw]), privateKey).toString("base64");
  return { raw, headers: new Headers({ "x-delivery-id": deliveryId, "x-key-id": kid, "x-signature": signature }) };
}
function fixture() {
  const events: CardEvent[] = [];
  let calls = 0;
  const handle = createImmersveWebhookHandler({
    config,
    now: () => NOW,
    client: { getJwks: async () => { calls++; return { keys: [key] }; } },
    store: { insert: async (event) => {
      if (events.some((existing) => existing.mode === event.mode && existing.messageId === event.messageId)) return false;
      events.push(event);
      return true;
    } },
  });
  return { events, handle, calls: () => calls };
}

describe("Immersve webhook", () => {
  test("accepts valid signed notification, dedupes retries, and persists only identifiers", async () => {
    const ctx = fixture();
    const first = delivery(JSON.stringify(envelope));
    expect(await ctx.handle(first.raw, first.headers, "payment-updated")).toBe(true);
    expect(await ctx.handle(first.raw, first.headers, "payment-updated")).toBe(true);
    expect(ctx.calls()).toBe(1);
    expect(ctx.events).toEqual([{ mode: "sandbox", messageId: "event-1", topic: "payment-updated", cardholderAccountId: "owner-1", cardId: "card-1", paymentId: "payment-1" }]);
    expect(JSON.stringify(ctx.events)).not.toContain("private-data");
  });
  test("rejects unknown route topics before JWKS and signed topic/segment mismatch", async () => {
    const ctx = fixture();
    const signed = delivery(JSON.stringify(envelope));
    expect(isImmersveWebhookTopic("payment-updated")).toBe(true);
    expect(isImmersveWebhookTopic("3ds-otp")).toBe(false);
    expect(await ctx.handle(signed.raw, signed.headers, "unlisted-topic")).toBe(false);
    expect(ctx.calls()).toBe(0);
    expect(await ctx.handle(signed.raw, signed.headers, "card-created")).toBe(false);
    expect(ctx.events).toEqual([]);
  });
  test("rejects tampering, wrong key, and mismatched signed header identity", async () => {
    const ctx = fixture();
    const signed = delivery(JSON.stringify(envelope));
    expect(await ctx.handle(new TextEncoder().encode(JSON.stringify({ ...envelope, topic: "card-created" })), signed.headers, "payment-updated")).toBe(false);
    expect(await ctx.handle(signed.raw, delivery(JSON.stringify(envelope), "event-1", "unknown").headers, "payment-updated")).toBe(false);
    const otherSignature = sign("RSA-SHA256", Buffer.concat([Buffer.from("event-1:1:first:"), signed.raw]), unrelatedPrivateKey).toString("base64");
    const wrongKeyHeaders = new Headers(signed.headers);
    wrongKeyHeaders.set("x-signature", otherSignature);
    expect(await ctx.handle(signed.raw, wrongKeyHeaders, "payment-updated")).toBe(false);
    const mismatch = delivery(JSON.stringify({ ...envelope, messageId: "different" }));
    expect(await ctx.handle(mismatch.raw, mismatch.headers, "payment-updated")).toBe(false);
    expect(ctx.calls()).toBe(1);
    expect(ctx.events).toEqual([]);
  });
  test("refetches once after 60 seconds for a rotated kid and bounds cache lifetime", async () => {
    let calls = 0;
    let time = NOW;
    const events: CardEvent[] = [];
    const handle = createImmersveWebhookHandler({
      config,
      now: () => time,
      client: { getJwks: async () => ({ keys: calls++ === 0 ? [key] : [{ ...key, kid: "next" }] }) },
      store: { insert: async (event) => { events.push(event); return true; } },
    });
    const original = delivery(JSON.stringify(envelope));
    expect(await handle(original.raw, original.headers, "payment-updated")).toBe(true);
    const rotated = delivery(JSON.stringify({ ...envelope, messageId: "event-2", keyId: "next" }), "event-2", "next");
    expect(await handle(rotated.raw, rotated.headers, "payment-updated")).toBe(false);
    time += 60_000;
    expect(await handle(rotated.raw, rotated.headers, "payment-updated")).toBe(true);
    expect(calls).toBe(2);
    time += 5 * 60_000 + 1;
    expect(await handle(rotated.raw, rotated.headers, "payment-updated")).toBe(true);
    expect(calls).toBe(3);
    expect(events).toHaveLength(3);
  });
  test("two distinct unknown kids within a minute cause only one JWKS fetch", async () => {
    const ctx = fixture();
    for (const kid of ["unknown-one", "unknown-two"]) {
      const signed = delivery(JSON.stringify(envelope), "event-1", kid);
      expect(await ctx.handle(signed.raw, signed.headers, "payment-updated")).toBe(false);
    }
    expect(ctx.calls()).toBe(1);
  });
  test("refuses non-string message IDs and signed events outside the 30-day replay window", async () => {
    const ctx = fixture();
    for (const messageId of [123, true]) {
      const signed = delivery(JSON.stringify({ ...envelope, messageId }), String(messageId));
      expect(await ctx.handle(signed.raw, signed.headers, "payment-updated")).toBe(false);
    }
    for (const createdAt of [undefined, "not-a-date", "2026-02-30T11:59:00Z", "2026-08-24T11:59:00.000Z", "2026-09-24T12:05:01.000Z"]) {
      const signed = delivery(JSON.stringify({ ...envelope, createdAt }));
      expect(await ctx.handle(signed.raw, signed.headers, "payment-updated")).toBe(false);
    }
    expect(ctx.events).toEqual([]);
  });
  test("rejects malformed JSON only after signature validation and refuses wrong issuer", async () => {
    const ctx = fixture();
    const broken = delivery("{broken");
    expect(await ctx.handle(broken.raw, broken.headers, "payment-updated")).toBe(false);
    const wrongIssuer = delivery(JSON.stringify({ ...envelope, issuer: "api.immersve.com" }));
    expect(await ctx.handle(wrongIssuer.raw, wrongIssuer.headers, "payment-updated")).toBe(false);
    expect(ctx.events).toEqual([]);
  });
  test("ignores 3DS bodies and retains only a KYC account identifier", async () => {
    const ctx = fixture();
    const otp = delivery(JSON.stringify({ ...envelope, topic: "3ds-otp", payload: { otp: "synthetic-otp" } }));
    expect(await ctx.handle(otp.raw, otp.headers, "3ds-otp")).toBe(false);
    const kyc = delivery(JSON.stringify({ ...envelope, messageId: "event-2", topic: "kyc-succeeded", payload: { accountId: "owner-1", name: "synthetic-private" } }), "event-2");
    expect(await ctx.handle(kyc.raw, kyc.headers, "kyc-succeeded")).toBe(true);
    expect(ctx.events).toEqual([{ mode: "sandbox", messageId: "event-2", topic: "kyc-succeeded", cardholderAccountId: "owner-1", cardId: null, paymentId: null }]);
  });
  test("rejects RSA keys shorter than 2048 bits", async () => {
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "jwk" });
    const ctx = createImmersveWebhookHandler({
      config,
      now: () => NOW,
      client: { getJwks: async () => ({ keys: [{ ...weak, kid: "first", alg: "RS256" }] }) },
      store: { insert: async () => { throw new Error("Weak signature reached storage"); } },
    });
    const signed = delivery(JSON.stringify(envelope));
    await expect(ctx(signed.raw, signed.headers, "payment-updated")).rejects.toThrow("Invalid Immersve JWKS");
  });
});
