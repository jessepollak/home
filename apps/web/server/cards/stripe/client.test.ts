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
  test("rejects oversized responses for card and cardholder reads", async () => {
    const fetcher = (async () => Response.json({ ...card, padding: "x".repeat(64 * 1024) })) as unknown as typeof fetch;
    const client = createStripeClient(config, fetcher);
    await expect(client.readCard("ic_123")).rejects.toThrow("response too large");
    await expect(client.readCardholder("ich_123")).rejects.toThrow("response too large");
  });
});

describe("Stripe Issuing write client", () => {
  test("issue uses virtual USD and Base USDC form encoding, freezes and clears the marker", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const params = new URLSearchParams(String(init.body));
      return Response.json({ ...card, status: params.get("status") === "inactive" ? "inactive" : "active", metadata: params.get("metadata[home_freeze]") === "customer" ? { home_freeze: "customer" } : {} });
    }) as typeof fetch;
    const client = createStripeClient(config, fetcher);
    const wallet = "0x1111111111111111111111111111111111111111";
    expect((await client.issueCard("ich_123", wallet, "issue-key")).status).toBe("active");
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("crypto_wallet[address]")).toBe(wallet);
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("crypto_wallet[chain]")).toBe("base");
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("crypto_wallet[currency]")).toBe("usdc");
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("crypto_wallet[type]")).toBe("standard");
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("type")).toBe("virtual");
    expect(calls[0]!.init.headers).toMatchObject({ "Idempotency-Key": "issue-key", "Content-Type": "application/x-www-form-urlencoded" });
    expect((await client.setCardFreeze("ic_123", true, "freeze-key")).customerFrozen).toBe(true);
    expect((await client.setCardFreeze("ic_123", false, "unfreeze-key")).customerFrozen).toBe(false);
    expect(new URLSearchParams(String(calls[2]!.init.body)).get("metadata[home_freeze]")).toBe("");
    expect(calls.every((call) => call.init.redirect === "manual" && call.init.signal !== undefined && call.init.cache === "no-store")).toBe(true);
  });
  test("sandbox financial account only and provider failures for each write", async () => {
    const account = { ...config, funding: { kind: "financial_account" as const, financialAccount: "fa_test" } };
    const fetcher = (async (_url: string, init: RequestInit) => {
      expect(new URLSearchParams(String(init.body)).get("financial_account_v2")).toBe("fa_test");
      return Response.json({ ...card, status: "active", metadata: {} });
    }) as typeof fetch;
    await createStripeClient(account, fetcher).issueCard("ich_123", "0x1111111111111111111111111111111111111111", "key");
    await expect(createStripeClient({ ...account, mode: "production" }, fetcher).issueCard("ich_123", "0x1111111111111111111111111111111111111111", "key")).rejects.toThrow("sandbox");
    const calls = [
      (client: ReturnType<typeof createStripeClient>) => client.issueCard("ich_123", "0x1111111111111111111111111111111111111111", "key"),
      (client: ReturnType<typeof createStripeClient>) => client.setCardFreeze("ic_123", true, "key"),
    ];
    for (const invoke of calls) {
      await expect(invoke(createStripeClient(config, (async () => new Response(null, { status: 503 })) as unknown as typeof fetch))).rejects.toThrow("503");
      await expect(invoke(createStripeClient(config, (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch))).rejects.toThrow("timed out");
      await expect(invoke(createStripeClient(config, (async () => Response.json({ id: "ic_123" })) as unknown as typeof fetch))).rejects.toThrow();
    }
  });
});

const runLive = process.env.CARDS_STRIPE_LIVE_TEST === "1" && process.env.BRIDGE_STRIPE_SECRET_KEY?.startsWith("sk_test_");
(runLive ? test : test.skip)("reads known Stripe test-mode card and cardholder without disclosing card data", async () => {
  const live = createStripeClient({ ...config, stripeSecretKey: process.env.BRIDGE_STRIPE_SECRET_KEY! });
  const result = await live.readCard("ic_1UKVXy1g1mZDnyPFpUOboOCx");
  expect(result.cardholderId).toBe("ich_1UKUXh1g1mZDnyPFcOEbC4H7");
  expect((await live.readCardholder(result.cardholderId)).id).toBe(result.cardholderId);
});
