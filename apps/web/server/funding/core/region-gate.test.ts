import "server-only";

import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { FundingProvider, FundingProviderManifest } from "@/shared/funding/provider-contract";
import { FundingCore } from "./service";
import { MemoryFundingOrderStore } from "./store";
import { MemoryFundingProviderCustomerStore } from "./customer-store";

const session: VerifiedAccountSession = {
  user: { subject: "test" }, accountProvider: "base-account",
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
};
const quoteRequest = { providerId: "fixture", region: "US", paymentMethod: "bank", fiatAmount: "25" };
const verification = { providerId: "fixture", region: "US", email: "test@example.com" };
const origin = "https://home.example";
const manifest = {
  id: "fixture", displayName: "Fixture", docsUrl: "https://example.com",
  onramp: { apiOrigins: ["https://example.com"], reference: "home" },
  bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["FIXTURE_KEY"] } } }],
} as const satisfies FundingProviderManifest;

type RegionState = "offered" | "removed" | "unavailable";
function fixture(withCustomer = false) {
  const store = new MemoryFundingOrderStore();
  const customerStore = new MemoryFundingProviderCustomerStore();
  let region: RegionState = "offered";
  let policyReads = 0;
  let dispatches = 0;
  let customerCreates = 0;
  let blockReads = 0;
  let now = new Date("2026-09-12T00:00:00.000Z");
  const provider: FundingProvider = {
    manifest: withCustomer ? { ...manifest, onramp: { ...manifest.onramp, customer: { handoffOrigins: ["https://verify.example.com"] } } } : manifest,
    onramp: {
      ...(withCustomer ? { customer: {
        async create() { customerCreates++; return { outcome: "created" as const, customerRef: "customer-1" }; },
        async startVerification() { return { outcome: "created" as const, providerUrl: "https://verify.example.com/start" }; },
        async getStatus() { return "verified" as const; },
      } } : {}),
      async createOrder(intent, context) {
        dispatches++;
        return { outcome: "created" as const, order: {
          providerOrderId: "provider-order", tokenAddress: context.binding.asset.address,
          expectedTokenAmountAtomic: intent.quote!.tokenAmountAtomic, fees: [], expiresAt: null,
          instructions: { kind: "bank-transfer" as const, rail: "ACH", accountNumber: "12345678", amount: intent.fiatAmount, currency: "USD" },
        } };
      },
      async getOrder() { return { state: "awaiting-payment" as const, providerStatus: "pending" }; },
    },
  };
  const core = new FundingCore({
    providers: [provider], store, customerStore,
    env: { FIXTURE_KEY: "set", ["FUNDING_" + "QUOTE_SECRET"]: "s".repeat(32) },
    regionOffered: async () => { policyReads++; if (region === "unavailable") throw new Error("settings unavailable"); return region === "offered"; },
    currentBaseBlock: async () => { blockReads++; return "500"; },
    verifyReceipt: async () => null, now: () => now,
  });
  return {
    core, setRegion(value: RegionState) { region = value; },
    advance() { now = new Date(now.getTime() + 60_000); },
    reads: () => policyReads, dispatches: () => dispatches, customerCreates: () => customerCreates, blockReads: () => blockReads,
  };
}

describe("funding region entry gate", () => {
  test.each(["onramp", "offramp"] as const)("lists %s corridors only while offered and fails closed on settings failure", async (direction) => {
    const entry = fixture();
    const offered = await entry.core.listProviders("US", session, direction);
    if (direction === "onramp") expect(offered).toHaveLength(1);
    else expect(offered).toEqual([]);
    entry.setRegion("removed");
    expect(await entry.core.listProviders("US", session, direction)).toEqual([]);
    entry.setRegion("unavailable");
    await expect(entry.core.listProviders("US", session, direction)).rejects.toMatchObject({ code: "PROVIDERS_UNAVAILABLE", status: 503 });
  });

  test("refuses new quotes for a removed region or unavailable settings", async () => {
    const entry = fixture();
    expect(await entry.core.createQuote(session, quoteRequest, origin)).toHaveProperty("quoteToken");
    entry.setRegion("removed");
    await expect(entry.core.createQuote(session, quoteRequest, origin)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 424 });
    entry.setRegion("unavailable");
    await expect(entry.core.createQuote(session, quoteRequest, origin)).rejects.toMatchObject({ code: "QUOTE_UNAVAILABLE", status: 503 });
    expect(entry.dispatches()).toBe(0);
  });

  test("refuses a pre-removal quote at order creation but keeps existing orders and reads available", async () => {
    const entry = fixture();
    const quote = await entry.core.createQuote(session, quoteRequest, origin);
    const token = { quoteToken: quote.quoteToken };
    entry.setRegion("removed");
    await expect(entry.core.createOrder(session, token, origin)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 424 });
    expect(entry.blockReads()).toBe(0);
    entry.setRegion("unavailable");
    await expect(entry.core.createOrder(session, token, origin)).rejects.toMatchObject({ code: "ORDER_UNAVAILABLE", status: 503 });
    expect(entry.dispatches()).toBe(0);
    entry.setRegion("offered");
    const order = await entry.core.createOrder(session, token, origin);
    expect(order.state).toBe("awaiting-payment");
    expect(entry.dispatches()).toBe(1);
    for (const policy of ["removed", "unavailable"] as const) {
      entry.setRegion(policy);
      entry.advance();
      const reads = entry.reads();
      expect((await entry.core.getOrder(session, order.id)).id).toBe(order.id);
      expect((await entry.core.getOpenOrder(session, "US"))?.id).toBe(order.id);
      expect((await entry.core.peekOpenOrder(session, "US"))?.id).toBe(order.id);
      expect((await entry.core.listOrderHistory(session)).map((item) => item.id)).toContain(order.id);
      expect((await entry.core.createOrder(session, token, origin)).id).toBe(order.id);
      expect(entry.reads()).toBe(reads);
    }
  });

  test("blocks verification entry before reserving customers but leaves customer status available", async () => {
    const entry = fixture(true);
    const started = await entry.core.startProviderCustomerVerification(session, verification, origin);
    expect(started.customer.providerId).toBe("fixture");
    expect(entry.customerCreates()).toBe(1);
    for (const [policy, code, status] of [["removed", "INVALID_VERIFICATION_REQUEST", 400], ["unavailable", "VERIFICATION_UNAVAILABLE", 503]] as const) {
      entry.setRegion(policy);
      await expect(entry.core.startProviderCustomerVerification(session, verification, origin)).rejects.toMatchObject({ code, status });
      expect(entry.customerCreates()).toBe(1);
      const reads = entry.reads();
      expect((await entry.core.listProviderCustomers(session, "US"))[0]?.providerId).toBe("fixture");
      expect(entry.reads()).toBe(reads);
    }
  });
});
