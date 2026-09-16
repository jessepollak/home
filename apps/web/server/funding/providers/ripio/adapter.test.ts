import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProviderContext } from "../../core/provider-context";
import { describeFundingAdapter } from "../../core/testing/describeFundingAdapter";
import { ripioProvider } from "./adapter";
import { ripioManifest } from "./manifest";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";

const env = { RIPIO_CLIENT_ID_AR: "client", RIPIO_CLIENT_SECRET_AR: "secret", RIPIO_WEBHOOK_SECRET_AR: "w".repeat(32) };
function context(fetchImplementation: typeof fetch) { return createProviderContext({ manifest: ripioManifest, region: "AR", paymentMethodId: "bank_transfer", env, fetchImplementation }); }
const homeOrderId = "11111111-1111-4111-8111-111111111111";
const customerRef = "22222222-2222-4222-8222-222222222222";
const quoteId = "33333333-3333-4333-8333-333333333333";
const providerOrderId = "44444444-4444-4444-8444-444444444444";
const intent = { homeOrderId, destination: "0x1111111111111111111111111111111111111111" as const, fiatAmount: "1000", customerRef, quote: { providerQuoteId: quoteId, fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" }, returnUrl: "https://home.example/fund" };
function tokenResponse() { return Response.json({ access_token: "synthetic-access-token", expires_in: 3600 }); }
function transaction(status = "CREATED", latestRefund: unknown = null) { return { transactionId: providerOrderId, status, txnHash: null, customerId: customerRef, quoteId, externalRef: homeOrderId, source: "ON_RAMP", fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", depositAddress: intent.destination, paymentMethodType: "bank_transfer", amount: "1000", latestRefund }; }

beforeEach(() => setObservabilityLogWriterForTests(() => undefined));
afterEach(() => setObservabilityLogWriterForTests());

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
    expect(ripioManifest.onramp.reference).toBe("home");
    expect(ripioManifest.onramp.quotes).toBe(true);
    expect(ripioManifest.bindings.map((binding) => binding.region)).toEqual(["AR", "BR", "CO"]);
    expect(ripioManifest.bindings[1]).toMatchObject({ region: "BR", assetId: "base:wbrl", currency: "BRL", directions: { onramp: { paymentMethods: [{ id: "pix" }], env: ["RIPIO_CLIENT_ID_BR", "RIPIO_CLIENT_SECRET_BR", "RIPIO_WEBHOOK_SECRET_BR"] } } });
  });

  test("maps an uncertain create failure to ambiguous and never retries", async () => {
    let calls = 0;
    const result = await ripioProvider.onramp!.createOrder({
      homeOrderId: "11111111-1111-4111-8111-111111111111",
      destination: "0x1111111111111111111111111111111111111111",
      fiatAmount: "1000", customerRef: "22222222-2222-4222-8222-222222222222",
      quote: { providerQuoteId: "33333333-3333-4333-8333-333333333333", fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      returnUrl: "https://home.example/fund",
    }, context((async () => { calls += 1; throw new Error("timeout"); }) as unknown as typeof fetch));
    expect(result).toEqual({ outcome: "ambiguous" });
    expect(calls).toBe(1);
  });

  test("emits only closed, scrubbed ambiguous-create evidence", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    const privateValue = `${homeOrderId}:${customerRef}:${intent.destination}:super-secret`;
    const result = await ripioProvider.onramp!.createOrder(intent, context((async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/oauth2/token/") return tokenResponse();
      throw new Error(privateValue);
    }) as unknown as typeof fetch));

    expect(result).toEqual({ outcome: "ambiguous" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      schema: "home.observability.v2",
      route: "/funding/providers/ripio",
      level: "error",
      kind: "funding-order",
      code: "ORDER_AMBIGUOUS",
      outcome: "unavailable",
      provider: "ripio",
      region: "AR",
      durationMs: expect.any(Number),
    });
    expect(lines[0]).not.toContain(homeOrderId);
    expect(lines[0]).not.toContain(customerRef);
    expect(lines[0]).not.toContain(intent.destination);
    expect(lines[0]).not.toContain("super-secret");
  });

  test("classifies malformed successful quote responses as invalid provider responses", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    const ctx = context((async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/oauth2/token/") return tokenResponse();
      if (path.includes("Networks")) {
        return Response.json([{
          network_name: "BASE",
          assets: [{ name: "wARS", contract_address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d" }],
        }]);
      }
      return new Response('{"quoteId":', { status: 200 });
    }) as unknown as typeof fetch);

    await expect(ripioProvider.onramp!.createQuote!({
      destination: intent.destination,
      fiatAmount: intent.fiatAmount,
      returnUrl: intent.returnUrl,
    }, ctx)).rejects.toMatchObject({ code: "ambiguous-create" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "funding-order",
      code: "PROVIDER_INVALID_RESPONSE",
      outcome: "failed",
      provider: "ripio",
      region: "AR",
    });
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
    await expect(ripioProvider.onramp!.ensureCustomer!({ subject: "user", fields: { email: "person@example.com", firstName: "A" } }, ctx)).rejects.toMatchObject({ code: "invalid-response" });
    expect(paths).not.toContain(`/api/v1/customers/${customerRef}/kyc/`);
  });

  test("maps Brazil Pix to the shared QR contract and stores the earlier Pix expiry", async () => {
    const brEnv = { ...env, RIPIO_CLIENT_ID_BR: "client", RIPIO_CLIENT_SECRET_BR: "secret", RIPIO_WEBHOOK_SECRET_BR: "b".repeat(32) };
    const brCode = "00020126320014br.gov.bcb.pix0110abcdefghij52040000530398654071000.005802BR5904HOME6004HOME63040CF7";
    const ctx = createProviderContext({
      manifest: ripioManifest,
      region: "BR",
      paymentMethodId: "pix",
      env: brEnv,
      fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/"
        ? tokenResponse()
        : Response.json({ transaction: { ...transaction(), fromCurrency: "BRL", toCurrency: "wBRL", paymentMethodType: "pix" }, fiatPaymentInstructions: { brCode, paymentUrl: "https://skala.ripio.com/pix", expiresAt: "2098-12-31T20:00:00-03:00" } })) as unknown as typeof fetch,
    });
    const result = await ripioProvider.onramp!.createOrder(intent, ctx);
    expect(result).toMatchObject({ outcome: "created", order: { expiresAt: "2098-12-31T23:00:00.000Z", instructions: { kind: "qr", scheme: "pix", payload: brCode, amount: "1000", currency: "BRL" } } });
    expect(JSON.stringify(result)).not.toContain("paymentUrl");
  });

  test("retains the quote expiry when Pix expires later and accepts a parseable past Pix expiry", async () => {
    const brEnv = { ...env, RIPIO_CLIENT_ID_BR: "client-expiry", RIPIO_CLIENT_SECRET_BR: "secret", RIPIO_WEBHOOK_SECRET_BR: "b".repeat(32) };
    const brCode = "00020126320014br.gov.bcb.pix0110abcdefghij52040000530398654071000.005802BR5904HOME6004HOME63040CF7";
    const create = (expiresAt: string) => ripioProvider.onramp!.createOrder(intent, createProviderContext({
      manifest: ripioManifest,
      region: "BR",
      paymentMethodId: "pix",
      env: brEnv,
      fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/"
        ? tokenResponse()
        : Response.json({ transaction: { ...transaction(), fromCurrency: "BRL", toCurrency: "wBRL", paymentMethodType: "pix" }, fiatPaymentInstructions: { brCode, expiresAt } })) as unknown as typeof fetch,
    }));
    await expect(create("2100-01-01T00:00:00.000Z")).resolves.toMatchObject({ outcome: "created", order: { expiresAt: intent.quote.expiresAt } });
    await expect(create("2020-01-01T00:00:00-03:00")).resolves.toMatchObject({ outcome: "created", order: { expiresAt: "2020-01-01T03:00:00.000Z" } });
  });

  test("polls a Brazil Pix order with the full BR binding", async () => {
    const brEnv = { ...env, RIPIO_CLIENT_ID_BR: "client-poll", RIPIO_CLIENT_SECRET_BR: "secret", RIPIO_WEBHOOK_SECRET_BR: "b".repeat(32) };
    const ctx = createProviderContext({
      manifest: ripioManifest,
      region: "BR",
      paymentMethodId: "pix",
      env: brEnv,
      fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/"
        ? tokenResponse()
        : Response.json({ ...transaction("PENDING"), fromCurrency: "BRL", toCurrency: "wBRL", paymentMethodType: "pix" })) as unknown as typeof fetch,
    });
    await expect(ripioProvider.onramp!.getOrder!({ homeOrderId, providerOrderId, providerQuoteId: quoteId, customerRef, transactionType: "MINT", chainId: 8453, tokenAddress: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0", destination: intent.destination, fiatAmount: "1000", expectedTokenAmountAtomic: intent.quote.tokenAmountAtomic, tokenDecimals: 18 }, ctx)).resolves.toMatchObject({ state: "awaiting-payment", providerStatus: "PENDING" });
  });

  test("rejects a provider rail that does not match the selected payment method", async () => {
    const coEnv = { RIPIO_CLIENT_ID_CO: "client", RIPIO_CLIENT_SECRET_CO: "secret", RIPIO_WEBHOOK_SECRET_CO: "w".repeat(32) };
    const ctx = createProviderContext({ manifest: ripioManifest, region: "CO", paymentMethodId: "breb", env: coEnv, fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transaction: { ...transaction(), fromCurrency: "COP", toCurrency: "wCOP", paymentMethodType: "breb" }, fiatPaymentInstructions: { paymentUrl: "https://skala.ripio.com/pay" } })) as unknown as typeof fetch });
    const result = await ripioProvider.onramp!.createOrder({ ...intent, quote: { ...intent.quote, tokenAmountAtomic: "1000000000000000000000" } }, ctx);
    expect(result).toEqual({ outcome: "ambiguous" });
  });

  test("rejects redirect instructions outside the manifest origin", async () => {
    const coEnv = { RIPIO_CLIENT_ID_CO: "client", RIPIO_CLIENT_SECRET_CO: "secret", RIPIO_WEBHOOK_SECRET_CO: "w".repeat(32) };
    const ctx = createProviderContext({ manifest: ripioManifest, region: "CO", paymentMethodId: "r2p_bancolombia", env: coEnv, fetchImplementation: (async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transaction: { ...transaction(), fromCurrency: "COP", toCurrency: "wCOP", paymentMethodType: "r2p_bancolombia" }, fiatPaymentInstructions: { paymentUrl: "https://evil.example/pay" } })) as unknown as typeof fetch });
    expect(await ripioProvider.onramp!.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
  });

  test("status requires customer, quote, external reference and full immutable intent echoes", async () => {
    const ctx = context((async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json({ transactionId: providerOrderId, status: "PENDING", txnHash: null, latestRefund: null })) as unknown as typeof fetch);
    await expect(ripioProvider.onramp!.getOrder!({ homeOrderId, providerOrderId, providerQuoteId: quoteId, customerRef, transactionType: "MINT", chainId: 8453, tokenAddress: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", destination: intent.destination, fiatAmount: "1000", expectedTokenAmountAtomic: intent.quote.tokenAmountAtomic, tokenDecimals: 18 }, ctx)).rejects.toMatchObject({ code: "binding-conflict" });
  });

  test("completed refunds win over a provider sent status", async () => {
    const ctx = context((async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/oauth2/token/" ? tokenResponse() : Response.json(transaction("COMPLETED", { status: "COMPLETED", rejectionReason: null }))) as unknown as typeof fetch);
    await expect(ripioProvider.onramp!.getOrder!({ homeOrderId, providerOrderId, providerQuoteId: quoteId, customerRef, transactionType: "MINT", chainId: 8453, tokenAddress: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", destination: intent.destination, fiatAmount: "1000", expectedTokenAmountAtomic: intent.quote.tokenAmountAtomic, tokenDecimals: 18 }, ctx)).resolves.toMatchObject({ state: "refunded" });
  });

  test("bounds provider response headers and bodies", async () => {
    for (const response of [
      () => new Response(JSON.stringify({ access_token: "synthetic-access-token", expires_in: 3600 }), { headers: { "x-oversized": "x".repeat(17 * 1024) } }),
      () => new Response(`{"padding":"${"x".repeat(65 * 1024)}"}`),
    ]) {
      let calls = 0;
      const result = await ripioProvider.onramp!.createOrder(intent, context((async () => { calls += 1; return response(); }) as unknown as typeof fetch));
      expect(result).toEqual({ outcome: "ambiguous" });
      expect(calls).toBe(1);
    }
  });

  test("reuses one OAuth token across operations for the same country and client", async () => {
    let tokenPosts = 0;
    const sharedFetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/oauth2/token/") {
        tokenPosts += 1;
        return tokenResponse();
      }
      return Response.json(transaction("PENDING"));
    }) as unknown as typeof fetch;
    const memoEnv = { ...env, RIPIO_CLIENT_ID_AR: "memo-client" };
    const input = { homeOrderId, providerOrderId, providerQuoteId: quoteId, customerRef, transactionType: "MINT" as const, chainId: 8453 as const, tokenAddress: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d" as const, destination: intent.destination, fiatAmount: "1000", expectedTokenAmountAtomic: intent.quote.tokenAmountAtomic, tokenDecimals: 18 };
    const first = createProviderContext({ manifest: ripioManifest, region: "AR", paymentMethodId: "bank_transfer", env: memoEnv, fetchImplementation: sharedFetch });
    const second = createProviderContext({ manifest: ripioManifest, region: "AR", paymentMethodId: "bank_transfer", env: memoEnv, fetchImplementation: sharedFetch });
    await ripioProvider.onramp!.getOrder!(input, first);
    await ripioProvider.onramp!.getOrder!(input, second);
    expect(tokenPosts).toBe(1);
  });

  test("verifies webhooks only with the selected country secret", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "ONRAMP_PAYMENT_RECEIVED", issueDatetime: "2026-09-12T00:00:00.000Z", transactionObject: { transactionId: "44444444-4444-4444-8444-444444444444" } }));
    const signature = createHmac("sha256", env.RIPIO_WEBHOOK_SECRET_AR).update(raw).digest("hex");
    const headers = new Headers({ "http-x-wh-signature-256": signature });
    const ar = context(fetch);
    const br = createProviderContext({ manifest: ripioManifest, region: "BR", paymentMethodId: "pix", env: { RIPIO_CLIENT_ID_BR: "client", RIPIO_CLIENT_SECRET_BR: "secret", RIPIO_WEBHOOK_SECRET_BR: "different" }, fetchImplementation: fetch });
    expect(ripioProvider.onramp!.verifyWebhook!(raw, headers, ar)).toEqual({ providerOrderId: "44444444-4444-4444-8444-444444444444" });
    expect(ripioProvider.onramp!.verifyWebhook!(raw, headers, br)).toBeNull();
    expect(ripioProvider.onramp!.verifyWebhook!(raw, new Headers({ "http-x-wh-signature-256": "0".repeat(64) }), ar)).toBeNull();
  });
});
