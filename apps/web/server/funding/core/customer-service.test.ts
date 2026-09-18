import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { FundingProvider, FundingProviderManifest } from "@/shared/funding/provider-contract";
import { coinbaseProvider } from "../providers/coinbase/adapter";
import { idrxProvider } from "../providers/idrx/adapter";
import { MemoryFundingProviderCustomerStore, type FundingProviderCustomerStore } from "./customer-store";
import { FundingCore } from "./service";
import { MemoryFundingOrderStore } from "./store";

const session: VerifiedAccountSession = { user: { subject: "customer-owner" }, accountProvider: "base-account", smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } };
const manifest = { id: "customer-fixture", displayName: "Customer fixture", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://api.example.com"], reference: "home", quotes: true, customer: { handoffOrigins: ["https://kyc.example.com"], fields: [{ name: "email", label: "Email", type: "email" }] } }, bindings: [{ region: "AR", assetId: "base:wars", currency: "ARS", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["KEY"] } } }] } as const satisfies FundingProviderManifest;

function core(provider: FundingProvider, customerStore: FundingProviderCustomerStore) {
  return new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), customerStore, env: { KEY: "set", FUNDING_QUOTE_SECRET: "q".repeat(32) }, currentBaseBlock: async () => "1", verifyReceipt: async () => null, now: () => new Date("2026-09-18T00:00:00.000Z") });
}

describe("provider customer service", () => {
  test("persists identity before one explicit hosted verification dispatch and never exposes its bearer URL on GET", async () => {
    let creates = 0;
    let verificationStarts = 0;
    let returnUrl = "";
    const provider: FundingProvider = { manifest, onramp: {
      customer: {
        async create() { creates += 1; return { outcome: "created", customerRef: "22222222-2222-4222-8222-222222222222", providerCreatedAt: "2026-09-18T00:00:00.000Z" }; },
        async startVerification(input) { verificationStarts += 1; returnUrl = input.returnUrl; return { outcome: "created", submissionRef: "33333333-3333-4333-8333-333333333333", providerUrl: "https://kyc.example.com/start?token=bearer", createdAt: "2026-09-18T00:00:00.000Z" }; },
      },
      async createQuote() { throw new Error("pending customer must not quote"); },
      async createOrder() { return { outcome: "ambiguous" }; },
      async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
    } };
    const service = core(provider, new MemoryFundingProviderCustomerStore());
    expect((await service.createProviderCustomer(session, { providerId: manifest.id, region: "AR", email: "person@example.com" })).state).toBe("pending");
    expect(creates).toBe(1);
    await expect(service.createQuote(session, { providerId: manifest.id, region: "AR", paymentMethod: "bank", fiatAmount: "100" }, "https://home.example")).rejects.toMatchObject({ code: "CUSTOMER_VERIFICATION_REQUIRED" });
    const started = await service.startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", fields: { email: "person@example.com" } }, "https://home.example", new Headers({ "x-forwarded-for": "203.0.113.7" }));
    expect(started.handoff?.url).toBe("https://kyc.example.com/start?token=bearer");
    expect(returnUrl).toBe("https://home.example/fund?return=verification");
    expect(JSON.stringify(await service.listProviderCustomers(session, "AR"))).not.toContain("bearer");
    await expect(service.startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", fields: { email: "person@example.com" } }, "https://home.example")).rejects.toMatchObject({ code: "VERIFICATION_ALREADY_STARTED" });
    expect(verificationStarts).toBe(1);
  });

  test("keeps Coinbase Embedded and IDRX direct discovery outside the customer store", async () => {
    let customerTouches = 0;
    const untouched = new Proxy({}, { get() { return () => { customerTouches += 1; throw new Error("customer store touched"); }; } }) as FundingProviderCustomerStore;
    const service = new FundingCore({ providers: [coinbaseProvider, idrxProvider], store: new MemoryFundingOrderStore(), customerStore: untouched, env: { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret", IDRX_CLIENT_ID: "id", IDRX_CLIENT_SECRET: "secret", IDRX_CUSTOMER_NAME: "Home", FUNDING_QUOTE_SECRET: "q".repeat(32) }, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    expect((await service.listProviders("US", session))[0]?.customerSetup).toBeNull();
    expect((await service.listProviders("ID", session))[0]?.customerSetup).toBeNull();
    expect(customerTouches).toBe(0);
  });
});
