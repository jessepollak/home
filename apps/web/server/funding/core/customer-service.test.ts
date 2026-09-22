import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { FundingProvider, FundingProviderManifest } from "@/shared/funding/provider-contract";
import { createCoinbaseProvider } from "../providers/coinbase/adapter";
import { idrxProvider } from "../providers/idrx/adapter";
import createQrisFixture from "../providers/idrx/fixtures/create-qris.synthetic.json";
import quoteQrisFixture from "../providers/idrx/fixtures/quote-qris.synthetic.json";
import { MemoryFundingProviderCustomerStore, type FundingProviderCustomerStore } from "./customer-store";
import { FundingCore } from "./service";
import { MemoryFundingOrderStore } from "./store";

const destination = "0x1111111111111111111111111111111111111111" as const;
const session: VerifiedAccountSession = { user: { subject: "customer-owner" }, accountProvider: "base-account", smartAccount: { address: destination, chainId: 8453 } };
const manifest = { id: "customer-fixture", displayName: "Customer fixture", docsUrl: "https://example.com", onramp: { apiOrigins: ["https://api.example.com"], reference: "home", quotes: true, customer: { handoffOrigins: ["https://kyc.example.com"] } }, bindings: [{ region: "AR", assetId: "base:wars", currency: "ARS", directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["KEY"] } } }] } as const satisfies FundingProviderManifest;

function core(provider: FundingProvider, customerStore: FundingProviderCustomerStore, now = () => new Date("2026-09-18T00:00:00.000Z")) {
  return new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), customerStore, env: { KEY: "set", FUNDING_QUOTE_SECRET: "q".repeat(32) }, currentBaseBlock: async () => "1", verifyReceipt: async () => null, now });
}

function customerProvider(options: {
  create?: "created" | "rejected" | "ambiguous";
  verification?: "created" | "rejected" | "ambiguous";
  status?: "pending" | "verified" | "rejected";
  onStart?: (input: { customerRef: string; clientIp?: string; redirectUrl: string }) => void;
} = {}): FundingProvider {
  return { manifest, onramp: {
    customer: {
      async create() {
        const outcome = options.create ?? "created";
        return outcome === "created" ? { outcome, customerRef: "22222222-2222-4222-8222-222222222222" } : { outcome };
      },
      async startVerification(input) {
        options.onStart?.(input);
        const outcome = options.verification ?? "created";
        return outcome === "created" ? { outcome, providerUrl: "https://kyc.example.com/start?token=bearer" } : { outcome };
      },
      async getStatus() { return options.status ?? "pending"; },
    },
    async createQuote(input) { return { fiatAmount: input.fiatAmount, tokenAmountAtomic: "100000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" }; },
    async createOrder() { return { outcome: "ambiguous" }; },
    async getOrder() { return { state: "unknown", providerStatus: "unknown" }; },
  } };
}

function untouchedCustomerStore(): FundingProviderCustomerStore {
  return new Proxy({}, { get(_target, property) { throw new Error(`customer store touched: ${String(property)}`); } }) as FundingProviderCustomerStore;
}

function partnerUserRef(): string {
  return createHash("sha256").update(`home:${destination.toLowerCase()}`).digest("hex").slice(0, 32);
}

function coinbaseResponse(isQuote: boolean): Response {
  const order = {
    orderId: "synthetic-order-1", status: "ONRAMP_ORDER_STATUS_PENDING_PAYMENT",
    paymentTotal: isQuote ? "25.00" : "25.50", paymentSubtotal: isQuote ? "24.50" : "25.00",
    paymentCurrency: "USD", paymentMethod: "GUEST_CHECKOUT_APPLE_PAY", purchaseAmount: "24.500000",
    purchaseCurrency: "USDC", fees: [{ type: "FEE_TYPE_EXCHANGE", amount: "0.50", currency: "USD" }],
    exchangeRate: "1", destinationAddress: destination, destinationNetwork: "base",
    createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", partnerUserRef: partnerUserRef(),
  };
  return Response.json(isQuote ? { source: "synthetic", order } : { source: "synthetic", order, paymentLink: { url: "https://pay.coinbase.com/embedded/apple-pay", paymentLinkType: "PAYMENT_LINK_TYPE_APPLE_PAY_BUTTON" } }, { status: 201 });
}

describe("provider customer service", () => {
  test("projects only hosted setup capability into provider discovery", async () => {
    const [binding] = await core(customerProvider(), new MemoryFundingProviderCustomerStore()).listProviders("AR", session);
    expect(binding?.customerSetup).toEqual({ hosted: true });
  });

  test("one explicit action persists identity before terms/KYC and returns the bearer URL only once", async () => {
    const events: string[] = [];
    const store = new MemoryFundingProviderCustomerStore();
    const provider = customerProvider({ onStart(input) { events.push(input.redirectUrl); } });
    provider.onramp!.customer!.create = async () => { events.push("created"); return { outcome: "created", customerRef: "22222222-2222-4222-8222-222222222222" }; };
    const service = core(provider, store);
    const started = await service.startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: "person@example.com" }, "https://home.example", new Headers({ "x-forwarded-for": "203.0.113.7" }));
    expect(events).toEqual(["created", "https://home.example/fund?return=verification"]);
    expect(started).toMatchObject({ customer: { state: "pending", verificationStartedAt: expect.any(String) }, handoff: { url: "https://kyc.example.com/start?token=bearer" } });
    expect(JSON.stringify(await service.listProviderCustomers(session, "AR"))).not.toContain("bearer");
    await expect(service.startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: "person@example.com" }, "https://home.example")).rejects.toMatchObject({ code: "VERIFICATION_ALREADY_STARTED" });
  });

  test("rejects an overlong email before reserving a customer row or creating a provider customer", async () => {
    const atLimit = `${"a".repeat(242)}@example.com`;
    const overLimit = `${"a".repeat(243)}@example.com`;
    expect(atLimit).toHaveLength(254);
    expect(overLimit).toHaveLength(255);
    let creates = 0;
    const provider = customerProvider();
    provider.onramp!.customer!.create = async () => { creates += 1; return { outcome: "created", customerRef: "22222222-2222-4222-8222-222222222222" }; };
    await expect(core(provider, untouchedCustomerStore()).startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: overLimit }, "https://home.example")).rejects.toMatchObject({ code: "INVALID_VERIFICATION_REQUEST", status: 400 });
    expect(creates).toBe(0);
    await expect(core(provider, new MemoryFundingProviderCustomerStore()).startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: atLimit }, "https://home.example")).resolves.toHaveProperty("handoff.url");
    expect(creates).toBe(1);
  });

  test("continues a durable pending-unstarted row without creating another provider customer", async () => {
    const store = new MemoryFundingProviderCustomerStore();
    const reserved = await store.reserve({ id: "11111111-1111-4111-8111-111111111111", owner: { subject: session.user.subject, accountProvider: session.accountProvider }, providerId: manifest.id, region: "AR", createdAt: "2026-09-18T00:00:00.000Z" });
    await store.completeCreate(reserved.customer.id, { customerRef: "22222222-2222-4222-8222-222222222222", expectedVersion: 0, updatedAt: "2026-09-18T00:00:00.000Z" });
    let creates = 0;
    const provider = customerProvider();
    provider.onramp!.customer!.create = async () => { creates += 1; return { outcome: "ambiguous" }; };
    await expect(core(provider, store).startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: "person@example.com" }, "https://home.example")).resolves.toHaveProperty("handoff.url");
    expect(creates).toBe(0);
  });

  test("keeps rejected and ambiguous writes blocked from automatic retry", async () => {
    for (const outcome of ["rejected", "ambiguous"] as const) {
      let creates = 0;
      const provider = customerProvider({ create: outcome });
      const original = provider.onramp!.customer!.create;
      provider.onramp!.customer!.create = async (...args) => { creates += 1; return original(...args); };
      const service = core(provider, new MemoryFundingProviderCustomerStore());
      const request = { providerId: manifest.id, region: "AR", email: "person@example.com" };
      await expect(service.startProviderCustomerVerification(session, request, "https://home.example")).resolves.toMatchObject({ customer: { state: outcome === "rejected" ? "rejected" : "dispatch-ambiguous" } });
      await expect(service.startProviderCustomerVerification(session, request, "https://home.example")).rejects.toMatchObject({ code: "CUSTOMER_NOT_READY" });
      expect(creates).toBe(1);
    }
  });

  test("reconciles exact verified/rejected status and preserves pending or failed reads", async () => {
    for (const [status, expected] of [["verified", "verified"], ["rejected", "rejected"], ["pending", "pending"]] as const) {
      const store = new MemoryFundingProviderCustomerStore();
      const service = core(customerProvider({ status }), store);
      await service.startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: "person@example.com" }, "https://home.example");
      expect((await service.listProviderCustomers(session, "AR"))[0]?.state).toBe(expected);
    }
    const store = new MemoryFundingProviderCustomerStore();
    const provider = customerProvider();
    provider.onramp!.customer!.getStatus = async () => { throw new Error("read uncertainty"); };
    const service = core(provider, store);
    await service.startProviderCustomerVerification(session, { providerId: manifest.id, region: "AR", email: "person@example.com" }, "https://home.example");
    expect((await service.listProviderCustomers(session, "AR"))[0]?.state).toBe("pending");
  });

  test("Coinbase Embedded quote/order never touches the customer store", async () => {
    const provider = createCoinbaseProvider({ generateJwtImplementation: async () => "synthetic-jwt" });
    const service = new FundingCore({ providers: [provider], store: new MemoryFundingOrderStore(), customerStore: untouchedCustomerStore(), env: { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret", FUNDING_QUOTE_SECRET: "q".repeat(32) }, fetchImplementation: (async (_input, init) => coinbaseResponse(JSON.parse(String(init?.body)).isQuote === true)) as typeof fetch, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    const quote = await service.createQuote(session, { providerId: "coinbase", region: "US", paymentMethod: "apple-pay", fiatAmount: "25" }, "https://home.example");
    await expect(service.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example")).resolves.toMatchObject({ state: "awaiting-payment" });
  });

  test("IDRX quote/order never touches the customer store", async () => {
    const service = new FundingCore({ providers: [idrxProvider], store: new MemoryFundingOrderStore(), customerStore: untouchedCustomerStore(), env: { IDRX_CLIENT_ID: "id", IDRX_CLIENT_SECRET: Buffer.from("secret").toString("base64"), IDRX_CUSTOMER_NAME: "HOME TEST CUSTOMER", FUNDING_QUOTE_SECRET: "q".repeat(32) }, fetchImplementation: (async (input: RequestInfo | URL) => Response.json(String(input).includes("mint-quote") ? quoteQrisFixture : createQrisFixture)) as unknown as typeof fetch, currentBaseBlock: async () => "1", verifyReceipt: async () => null });
    const quote = await service.createQuote(session, { providerId: "idrx", region: "ID", paymentMethod: "qris", fiatAmount: "20000.50" }, "https://home.example");
    await expect(service.createOrder(session, { quoteToken: quote.quoteToken }, "https://home.example")).resolves.toMatchObject({ state: "awaiting-payment" });
  });
});
