import { describe, expect, test } from "bun:test";
import { createStripeClient, parseStripeCard, parseStripeCardholder } from "./client";
import type { CardJourneyConfig } from "../bridge/journey-config";

const config: CardJourneyConfig = { mode: "sandbox", bridgeOrigin: "https://api.sandbox.bridge.xyz", bridgeApiKey: "fake",
  stripeSecretKey: "sk_test_fake", stripeApiVersion: "2026-08-26.dahlia", funding: { kind: "crypto_wallet" } };
const card = { id: "ic_123", cardholder: "ich_123", status: "inactive", last4: "1234", metadata: { home_freeze: "customer" } };

describe("Stripe Issuing read client", () => {
  test("reads card/cardholder with pinned version and strips sensitive fields", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json(url.includes("cardholders") ? { id: "ich_123", status: "active" } : { ...card, number: "should-not-escape" });
    }) as typeof fetch;
    const client = createStripeClient(config, fetcher);
    expect(await client.readCard("ic_123")).toEqual({ id: "ic_123", cardholderId: "ich_123", status: "inactive", last4: "1234", customerFrozen: true });
    expect(await client.readCardholder("ich_123")).toEqual({ id: "ich_123", status: "active" });
    expect(calls.map((call) => call.init.headers && (call.init.headers as Record<string, string>)["Stripe-Version"])).toEqual([config.stripeApiVersion, config.stripeApiVersion]);
    expect(calls.every((call) => call.init.redirect === "manual" && call.init.signal !== undefined)).toBe(true);
  });
  test("rejects malformed status, metadata marker, holder, and mismatched IDs", async () => {
    expect(() => parseStripeCard({ ...card, status: "blocked" })).toThrow();
    expect(() => parseStripeCard({ ...card, metadata: { home_freeze: "provider" } })).toThrow();
    expect(() => parseStripeCardholder({ id: "ich_123", status: "unknown" })).toThrow();
    await expect(createStripeClient(config, (async () => Response.json({ ...card, id: "ic_999" })) as unknown as typeof fetch).readCard("ic_123")).rejects.toThrow("mismatch");
    await expect(createStripeClient(config, (async () => new Response(null, { status: 500 })) as unknown as typeof fetch).readCard("ic_123")).rejects.toThrow("500");
  });
});

const runLive = process.env.CARDS_STRIPE_LIVE_TEST === "1" && process.env.BRIDGE_STRIPE_SECRET_KEY?.startsWith("sk_test_");
(runLive ? test : test.skip)("reads known Stripe test-mode card and cardholder without disclosing card data", async () => {
  const live = createStripeClient({ ...config, stripeSecretKey: process.env.BRIDGE_STRIPE_SECRET_KEY! });
  const result = await live.readCard("ic_1UKVXy1g1mZDnyPFpUOboOCx");
  expect(result.cardholderId).toBe("ich_1UKUXh1g1mZDnyPFcOEbC4H7");
  expect((await live.readCardholder(result.cardholderId)).id).toBe(result.cardholderId);
});
