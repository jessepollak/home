import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createProviderContext } from "../../core/provider-context";
import { describeFundingAdapter } from "../../core/testing/describeFundingAdapter";
import { ripioProvider } from "./adapter";
import { ripioManifest } from "./manifest";

const env = { RIPIO_CLIENT_ID_AR: "client", RIPIO_CLIENT_SECRET_AR: "secret", RIPIO_WEBHOOK_SECRET: "w".repeat(32) };
function context(fetchImplementation: typeof fetch) { return createProviderContext({ manifest: ripioManifest, region: "AR", paymentMethodId: "bank_transfer", env, fetchImplementation }); }
const homeOrderId = "11111111-1111-4111-8111-111111111111";
const customerRef = "22222222-2222-4222-8222-222222222222";
const quoteId = "33333333-3333-4333-8333-333333333333";
const providerOrderId = "44444444-4444-4444-8444-444444444444";
const intent = { homeOrderId, destination: "0x1111111111111111111111111111111111111111" as const, fiatAmount: "1000", customerRef, quote: { providerQuoteId: quoteId, fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" }, returnUrl: "https://home.example/fund" };
function tokenResponse() { return Response.json({ access_token: "synthetic-access-token", expires_in: 3600 }); }
function transaction(status = "CREATED", latestRefund: unknown = null) { return { transactionId: providerOrderId, status, txnHash: null, customerId: customerRef, quoteId, externalRef: homeOrderId, source: "ON_RAMP", fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", depositAddress: intent.destination, paymentMethodType: "bank_transfer", amount: "1000", latestRefund }; }

describeFundingAdapter({
  provider: ripioProvider,
  region: "AR",
  paymentMethodId: "bank_transfer",
  env,
  intent,
  createRequestPath: "/api/v1/onramp/",
  reconciliationProviderOrderId: providerOrderId,
  successResponse: (_index, url) => new URL(url).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transaction: transaction(), fiatPaymentInstructions: { cvu: "1234567890123456789012" } }),
  invalidCreateResponses: [{ name: "malformed successful order", response: (_index, url) => new URL(url).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transaction: transaction() }) }],
  unknownStatusResponse: (_index, url) => new URL(url).pathname === "/oauth2/token/" ? tokenResponse() : Response.json(transaction("UNDOCUMENTED")),
});

describe("Ripio funding adapter", () => {
  test("declares independently configured country bindings", () => {
    expect(ripioManifest.reference).toBe("home");
    expect(ripioManifest.quotes).toBe(true);
    expect(ripioManifest.bindings.map((binding) => binding.region)).toEqual(["AR", "CO"]);
  });

  test("maps an uncertain create failure to ambiguous and never retries", async () => {
    let calls = 0;
    const result = await ripioProvider.createOrder({
      homeOrderId: "11111111-1111-4111-8111-111111111111",
      destination: "0x1111111111111111111111111111111111111111",
      fiatAmount: "1000", customerRef: "22222222-2222-4222-8222-222222222222",
      quote: { providerQuoteId: "33333333-3333-4333-8333-333333333333", fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      returnUrl: "https://home.example/fund",
    }, context((async () => { calls += 1; throw new Error("timeout"); }) as unknown as typeof fetch));
    expect(result).toEqual({ outcome: "ambiguous" });
    expect(calls).toBe(1);
  });

  test("fails closed when terms cannot be identified and never submits KYC", async () => {
    const paths: string[] = [];
    const ctx = context((async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path === "/oauth2/token/") return tokenResponse();
      if (path === "/api/v1/customers/") return Response.json({ customerId: customerRef, createdAt: "2026-09-12T00:00:00.000Z" });
      if (path === "/api/v1/termsAndConditions/") return Response.json({ results: [] });
      throw new Error("unexpected request");
    }) as unknown as typeof fetch);
    await expect(ripioProvider.ensureCustomer!({ subject: "user", fields: { email: "person@example.com", firstName: "A" } }, ctx)).rejects.toMatchObject({ code: "invalid-response" });
    expect(paths).not.toContain(`/api/v1/customers/${customerRef}/kyc/`);
  });

  test("rejects a provider rail that does not match the selected payment method", async () => {
    const coEnv = { RIPIO_CLIENT_ID_CO: "client", RIPIO_CLIENT_SECRET_CO: "secret", RIPIO_WEBHOOK_SECRET: "w".repeat(32) };
    const ctx = createProviderContext({ manifest: ripioManifest, region: "CO", paymentMethodId: "breb", env: coEnv, fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transaction: { ...transaction(), fromCurrency: "COP", toCurrency: "wCOP", paymentMethodType: "breb" }, fiatPaymentInstructions: { paymentUrl: "https://skala.ripio.com/pay" } })) as unknown as typeof fetch });
    const result = await ripioProvider.createOrder({ ...intent, quote: { ...intent.quote, tokenAmountAtomic: "1000000000000000000000" } }, ctx);
    expect(result).toEqual({ outcome: "ambiguous" });
  });

  test("rejects redirect instructions outside the manifest origin", async () => {
    const coEnv = { RIPIO_CLIENT_ID_CO: "client", RIPIO_CLIENT_SECRET_CO: "secret", RIPIO_WEBHOOK_SECRET: "w".repeat(32) };
    const ctx = createProviderContext({ manifest: ripioManifest, region: "CO", paymentMethodId: "r2p_bancolombia", env: coEnv, fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transaction: { ...transaction(), fromCurrency: "COP", toCurrency: "wCOP", paymentMethodType: "r2p_bancolombia" }, fiatPaymentInstructions: { paymentUrl: "https://evil.example/pay" } })) as unknown as typeof fetch });
    expect(await ripioProvider.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
  });

  test("status requires customer, quote, external reference and full immutable intent echoes", async () => {
    const ctx = context((async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transactionId: providerOrderId, status: "PENDING", txnHash: null, latestRefund: null })) as unknown as typeof fetch);
    await expect(ripioProvider.getOrder!({ homeOrderId, providerOrderId, providerQuoteId: quoteId, customerRef, transactionType: "MINT", chainId: 8453, tokenAddress: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", destination: intent.destination, fiatAmount: "1000", expectedTokenAmountAtomic: intent.quote.tokenAmountAtomic, tokenDecimals: 18 }, ctx)).rejects.toMatchObject({ code: "binding-conflict" });
  });

  test("completed refunds win over a provider sent status", async () => {
    const ctx = context((async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json(transaction("COMPLETED", { status: "COMPLETED", rejectionReason: null }))) as unknown as typeof fetch);
    await expect(ripioProvider.getOrder!({ homeOrderId, providerOrderId, providerQuoteId: quoteId, customerRef, transactionType: "MINT", chainId: 8453, tokenAddress: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", destination: intent.destination, fiatAmount: "1000", expectedTokenAmountAtomic: intent.quote.tokenAmountAtomic, tokenDecimals: 18 }, ctx)).resolves.toMatchObject({ state: "refunded" });
  });

  test("bounds provider response headers and bodies", async () => {
    for (const response of [
      () => new Response(JSON.stringify({ access_token: "synthetic-access-token", expires_in: 3600 }), { headers: { "x-oversized": "x".repeat(17 * 1024) } }),
      () => new Response(`{"padding":"${"x".repeat(65 * 1024)}"}`),
    ]) {
      let calls = 0;
      const result = await ripioProvider.createOrder(intent, context((async () => { calls += 1; return response(); }) as unknown as typeof fetch));
      expect(result).toEqual({ outcome: "ambiguous" });
      expect(calls).toBe(1);
    }
  });

  test("verifies the raw webhook body before returning a provider order ID", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "ONRAMP_PAYMENT_RECEIVED", issueDatetime: "2026-09-12T00:00:00.000Z", transactionObject: { transactionId: "44444444-4444-4444-8444-444444444444" } }));
    const signature = createHmac("sha256", env.RIPIO_WEBHOOK_SECRET).update(raw).digest("hex");
    expect(ripioProvider.verifyWebhook!(raw, new Headers({ "http-x-wh-signature-256": signature }), context(fetch))).toEqual({ providerOrderId: "44444444-4444-4444-8444-444444444444" });
    expect(ripioProvider.verifyWebhook!(raw, new Headers({ "http-x-wh-signature-256": "0".repeat(64) }), context(fetch))).toBeNull();
  });
});
