import { describe, expect, test } from "bun:test";
import { fixtureFetch } from "@/tests/helpers/fetch";
import { parseJson } from "@/tests/helpers/read-json";
import type { ProviderContext } from "@/shared/funding/provider-contract";
import { createProviderContext } from "../../core/provider-context";
import { createRipioClient as createClient, RipioProviderError, sameRipioDecimal } from "./client";
import { ripioManifest } from "./manifest";

function createRipioClient(country: "AR" | "BR", options: {
  env: Record<string, string>;
  fetchImplementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}) {
  const ctx = createProviderContext({
    manifest: ripioManifest,
    region: country,
    paymentMethodId: country === "AR" ? "bank_transfer" : "pix",
    env: { ...options.env, [`RIPIO_WEBHOOK_SECRET_${country}`]: "synthetic-webhook-secret" },
    fetchImplementation: fixtureFetch(options.fetchImplementation),
  });
  return createClient(country, { env: options.env, request: ctx.request, now: options.now });
}

const ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const EXTERNAL = "44444444-4444-4444-8444-444444444444";
const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const env = {
  RIPIO_CLIENT_ID_AR: "client-ar",
  RIPIO_CLIENT_SECRET_AR: "secret-ar-long-enough",
};
const brEnv = {
  RIPIO_CLIENT_ID_BR: "client-br",
  RIPIO_CLIENT_SECRET_BR: "secret-br-long-enough",
};
const PIX_CODE = "00020126320014br.gov.bcb.pix0110abcdefghij5204000053039865406100.005802BR5904HOME6004HOME6304C027";

test("2300 and 2300.00000000 are the same debit", () => {
  expect(sameRipioDecimal("2300", "2300.00000000")).toBe(true);
  expect(sameRipioDecimal("2300", "2300.00000001")).toBe(false);
});

function token() {
  return Response.json({ access_token: "provider-access-token", expires_in: 36000, scope: "read write" });
}

function arCatalog() {
  return Response.json([{ network_name: "BASE", assets: [{ name: "wARS", contract_address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d" }] }]);
}

const expectedBinding = { customerId: CUSTOMER, quoteId: QUOTE, externalRef: EXTERNAL, destination: DESTINATION, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", finalToAmount: "2100" } as const;

function productionTransaction(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: ID,
    createdAt: "2026-09-11T18:00:00Z",
    customerId: CUSTOMER,
    quoteId: QUOTE,
    fromCurrency: "ARS",
    toCurrency: "wARS",
    amount: "2100",
    chain: "BASE",
    paymentMethodType: "bank_transfer",
    depositAddress: DESTINATION,
    source: "ON_RAMP",
    metadata: {},
    txnHash: null,
    sender: "Synthetic fixture",
    status: "CREATED",
    refundable: false,
    refundDestinationRequired: false,
    latestRefund: null,
    ...overrides,
  };
}

const checksumAddress = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
const lowercaseAddress = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" as const;
const invalidChecksumAddress = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;

describe("Ripio branded provider ingress", () => {
  test.each([
    [lowercaseAddress, checksumAddress],
    [checksumAddress, lowercaseAddress],
  ] as const)("normalizes deposit echoes while preserving quote and onramp wire fields for %s", async (destination, depositAddress) => {
    const bodies: unknown[] = [];
    const client = createRipioClient("AR", { env, fetchImplementation: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/oauth2/token/") return token();
      if (path.includes("Networks")) return arCatalog();
      if (init?.body) bodies.push(parseJson(String(init.body)));
      if (path === "/api/v1/quotes/") return Response.json({ quoteId: QUOTE, customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", finalFromAmount: "2100", toAmount: "2100", finalToAmount: "2100", rate: "1", expiration: "2099-01-01T00:00:00.000Z", fees: [] });
      const transaction = productionTransaction({ externalRef: EXTERNAL, depositAddress, txnHash: `0x${"AB".repeat(32)}` });
      return Response.json(init?.method === "POST" ? { transaction, fiatPaymentInstructions: { cvu: "1234567890123456789012" } } : transaction);
    } });
    await client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination });
    const binding = { ...expectedBinding, destination };
    expect(await client.createOnramp({ ...binding, fiatAmount: "2100" })).toMatchObject({ destination: lowercaseAddress, txnHash: `0x${"ab".repeat(32)}` });
    expect(await client.getTransaction(ID, binding)).toMatchObject({ destination: lowercaseAddress, txnHash: `0x${"ab".repeat(32)}` });
    expect(bodies).toEqual([
      { customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer" },
      { customerId: CUSTOMER, quoteId: QUOTE, depositAddress: destination, externalRef: EXTERNAL },
    ]);
  });

  test.each([invalidChecksumAddress, "0x1234", "0xgggggggggggggggggggggggggggggggggggggggg"] as const)("rejects invalid destination %s before quote or create I/O", async (destination) => {
    let calls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => { calls += 1; return token(); } });
    await expect(client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(client.createOnramp({ ...expectedBinding, destination, fiatAmount: "2100" })).rejects.toMatchObject({ code: "invalid-request" });
    expect(calls).toBe(0);
  });

  test.each([
    ...[invalidChecksumAddress, "0x1234", `0x${"g".repeat(40)}`].map((depositAddress) => ({ depositAddress })),
    ...["0x1234", `0x${"g".repeat(64)}`, `0X${"AB".repeat(32)}`, 42].map((txnHash) => ({ txnHash })),
  ])("fails malformed transaction fields closed at create and retrieval: %j", async (overrides) => {
    const client = createRipioClient("AR", { env, fetchImplementation: async (input, init) => {
      if (new URL(String(input)).pathname === "/oauth2/token/") return token();
      const transaction = productionTransaction(overrides);
      return Response.json(init?.method === "POST" ? { transaction, fiatPaymentInstructions: { cvu: "1234567890123456789012" } } : transaction);
    } });
    await expect(client.createOnramp({ ...expectedBinding, fiatAmount: "2100" })).rejects.toMatchObject({ code: "ambiguous-create" });
    await expect(client.getTransaction(ID, expectedBinding)).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("Ripio production REST client", () => {
  test.each(["transport", "timeout", "aborted"] as const)("keeps token %s unavailable for reads and creates", async (kind) => {
    const request: ProviderContext["request"] = async (_input, options) => {
      expect(options).toMatchObject({ maxBytes: 64 * 1024, maxHeaderBytes: 16 * 1024, responseType: "json" });
      expect(options.errorBodyMaxBytes).toBeUndefined();
      return { ok: false, kind };
    };
    const client = createClient("AR", { env, request });
    await expect(client.getDepositNetworks()).rejects.toMatchObject({ code: "unavailable", status: null });
    await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "unavailable", status: null });
  });

  test.each(["transport", "timeout", "aborted"] as const)("maps request %s to unavailable for reads and ambiguous for creates", async (kind) => {
    const bounded = createProviderContext({
      manifest: ripioManifest, region: "AR", paymentMethodId: "bank_transfer",
      env: { ...env, RIPIO_WEBHOOK_SECRET_AR: "synthetic-webhook-secret" },
      fetchImplementation: fixtureFetch(async () => token()),
    }).request;
    let tokenCalls = 0;
    let requestCalls = 0;
    const request: ProviderContext["request"] = async (input, options) => {
      expect(options).toMatchObject({ maxBytes: 64 * 1024, maxHeaderBytes: 16 * 1024, responseType: "json" });
      expect(options.errorBodyMaxBytes).toBeUndefined();
      if (new URL(input).pathname === "/oauth2/token/") {
        tokenCalls += 1;
        return bounded(input, options);
      }
      requestCalls += 1;
      return { ok: false, kind };
    };
    const client = createClient("AR", { env, request });
    await expect(client.getDepositNetworks()).rejects.toMatchObject({ code: "unavailable", status: null });
    await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "ambiguous-create", status: null });
    expect(tokenCalls).toBe(1);
    expect(requestCalls).toBe(2);
  });

  test.each(["oversized", "invalid"] as const)("maps a %s success-body failure without status to invalid-response", async (kind) => {
    const tokenFailure: ProviderContext["request"] = async () => ({ ok: false, kind });
    await expect(createClient("AR", { env, request: tokenFailure }).getDepositNetworks()).rejects.toMatchObject({ code: "invalid-response", status: null });
    const client = createRipioClient("AR", { env, fetchImplementation: async (input) => {
      if (new URL(String(input)).pathname === "/oauth2/token/") return token();
      return new Response(kind === "oversized" ? "x".repeat(65 * 1024) : "not-json");
    } });
    await expect(client.getDepositNetworks()).rejects.toMatchObject({ code: "invalid-response", status: null });
    await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "ambiguous-create", status: null });
  });

  test("keeps token caching, expiry cap and one-minute refresh margin unchanged", async () => {
    let now = 0;
    let tokenPosts = 0;
    const client = createRipioClient("AR", { env, now: () => now, fetchImplementation: async (input) => {
      if (new URL(String(input)).pathname !== "/oauth2/token/") return Response.json([]);
      tokenPosts += 1;
      return Response.json({ access_token: "provider-access-token", expires_in: 72_000 });
    } });
    await client.getDepositNetworks();
    await client.getWithdrawalNetworks();
    now = 36_000_000 - 60_001;
    await client.getDepositNetworks();
    expect(tokenPosts).toBe(1);
    now += 1;
    await client.getDepositNetworks();
    expect(tokenPosts).toBe(2);
  });

  test.each([401, 403])("clears the cached token after request HTTP %s without reading the error body", async (status) => {
    let tokenPosts = 0;
    let requestCalls = 0;
    let bodyReads = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async (input) => {
      if (new URL(String(input)).pathname === "/oauth2/token/") {
        tokenPosts += 1;
        return token();
      }
      requestCalls += 1;
      if (requestCalls > 1) return Response.json([]);
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) { bodyReads += 1; controller.enqueue(new Uint8Array([1])); },
      }, { highWaterMark: 0 }), { status, headers: { "x-oversized": "x".repeat(17 * 1024) } });
    } });
    await expect(client.getDepositNetworks()).rejects.toMatchObject({ code: "unauthorized", status });
    await client.getDepositNetworks();
    expect(tokenPosts).toBe(2);
    expect(bodyReads).toBe(0);
  });

  test.each([401, 403, 400, 429, 503])("maps token HTTP %s by status without reading the error body", async (status) => {
    let reads = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { reads += 1; controller.enqueue(new Uint8Array([1])); },
    }, { highWaterMark: 0 }), { status }) });
    await expect(client.getDepositNetworks()).rejects.toMatchObject({ code: status === 401 || status === 403 ? "unauthorized" : "unavailable", status });
    expect(reads).toBe(0);
  });
  test("uses only the exact country credential pair and production host", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createRipioClient("AR", {
      env,
      fetchImplementation: async (input, init) => {
        requests.push({ url: String(input), init });
        if (requests.length === 1) return token();
        return Response.json({ networks: [] });
      },
    });
    await client.getDepositNetworks();
    expect(requests.map((request) => request.url)).toEqual([
      "https://skala.ripio.com/oauth2/token/",
      "https://skala.ripio.com/api/v1/depositNetworks/?include_currency=true",
    ]);
    expect(String(requests[0]?.init?.headers)).not.toContain("secret-ar-long-enough");
  });

  test("rejects cross-country/token/rail quote combinations before provider I/O", async () => {
    let calls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => { calls += 1; return token(); } });
    await expect(client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wCOP", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toBeInstanceOf(RipioProviderError);
    expect(calls).toBe(0);
  });

  test("parses quote economics and country-specific rail instructions", async () => {
    let call = 0;
    const client = createRipioClient("AR", {
      env,
      fetchImplementation: async () => {
        call += 1;
        if (call === 1) return token();
        if (call === 2 || call === 3) return arCatalog();
        if (call === 4) return Response.json({ quoteId: QUOTE, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", finalFromAmount: "2110", toAmount: "2100", finalToAmount: "2100", rate: "1", expiration: "2026-09-11T22:00:00.000Z", fees: [{ amount: "10", type: "service", currency: "ARS", appliesOnFromAmount: true, appliesOnToAmount: false }] });
        return Response.json({ transaction: productionTransaction(), fiatPaymentInstructions: { cvu: "1234567890123456789012", alias: "home.ripio" } });
      },
    });
    const quote = await client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION });
    expect(quote.fees[0]).toMatchObject({ amount: "10", appliesOnFromAmount: true });
    const order = await client.createOnramp({ customerId: CUSTOMER, quoteId: QUOTE, externalRef: EXTERNAL, destination: DESTINATION, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", finalToAmount: "2100", fiatAmount: "2110" });
    expect(order.instructions).toEqual({ kind: "ar-bank-transfer", cvu: "1234567890123456789012", alias: "home.ripio" });
  });

  test("prices the quote against the verified customer", async () => {
    let call = 0;
    let quoteBody: unknown;
    const client = createRipioClient("AR", {
      env,
      fetchImplementation: async (_input, init) => {
        call += 1;
        if (call === 1) return token();
        if (call === 2 || call === 3) return arCatalog();
        quoteBody = parseJson(String(init?.body));
        return Response.json({ quoteId: QUOTE, customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", finalFromAmount: "2100", toAmount: "2100", finalToAmount: "2100", rate: "1", expiration: "2099-01-01T00:00:00.000Z", fees: [] });
      },
    });
    await client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION });
    expect(quoteBody).toMatchObject({ customerId: CUSTOMER });
  });

  test("treats a quote priced against a different customer as ambiguous and rejects a non-uuid customer before provider I/O", async () => {
    let call = 0;
    const client = createRipioClient("AR", {
      env,
      fetchImplementation: async () => {
        call += 1;
        if (call === 1) return token();
        if (call === 2 || call === 3) return arCatalog();
        return Response.json({ quoteId: QUOTE, customerId: ID, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", finalFromAmount: "2100", toAmount: "2100", finalToAmount: "2100", rate: "1", expiration: "2099-01-01T00:00:00.000Z", fees: [] });
      },
    });
    await expect(client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toMatchObject({ code: "ambiguous-create" });
    const calledAfterEcho = call;
    await expect(client.createQuote({ country: "AR", customerId: "not-a-uuid", fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toMatchObject({ code: "invalid-request" });
    expect(call).toBe(calledAfterEcho);
  });

  test("fails closed when either live production catalog lacks the exact Base token contract", async () => {
    let calls = 0;
    const client = createRipioClient("AR", {
      env,
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return token();
        if (calls === 2) return arCatalog();
        return Response.json([{ network_name: "ETHEREUM_SEPOLIA", assets: [{ name: "RTEST", contract_address: "0x0472eDf217331A7809e33AA0920b8ab864EEB437" }] }]);
      },
    });
    await expect(client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toMatchObject({ code: "binding-conflict" });
    expect(calls).toBe(3);
  });

  test("enforces Brazil country input and the exact wBRL Base catalog address", async () => {
    let calls = 0;
    const client = createRipioClient("BR", {
      env: brEnv,
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return token();
        if (calls === 2 || calls === 3) return Response.json([{ network_name: "BASE", assets: [{ name: "wBRL", contract_address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0" }] }]);
        return Response.json({ quoteId: QUOTE, fromCurrency: "BRL", toCurrency: "wBRL", fromAmount: "100.00", finalFromAmount: "100.00", toAmount: "100", finalToAmount: "100", rate: "1", expiration: "2099-01-01T00:00:00.000Z", fees: [] });
      },
    });
    await expect(client.createQuote({ country: "AR", customerId: CUSTOMER, fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toMatchObject({ code: "invalid-request" });
    expect(calls).toBe(0);
    await expect(client.createQuote({ country: "BR", customerId: CUSTOMER, fromCurrency: "BRL", toCurrency: "wBRL", fromAmount: "100.00", chain: "BASE", paymentMethodType: "pix", destination: DESTINATION })).resolves.toMatchObject({ finalToAmount: "100" });
    expect(calls).toBe(4);
  });

  test("parses Brazil Pix instructions and fails malformed or mismatched instructions closed as ambiguous", async () => {
    const brTransaction = productionTransaction({ fromCurrency: "BRL", toCurrency: "wBRL", paymentMethodType: "pix", amount: "100" });
    const create = (instructions: Record<string, unknown>) => createRipioClient("BR", {
      env: brEnv,
      fetchImplementation: async (input) => new URL(String(input)).pathname === "/oauth2/token/"
        ? token()
        : Response.json({ transaction: brTransaction, fiatPaymentInstructions: instructions }),
    }).createOnramp({ customerId: CUSTOMER, quoteId: QUOTE, externalRef: EXTERNAL, destination: DESTINATION, fromCurrency: "BRL", toCurrency: "wBRL", chain: "BASE", paymentMethodType: "pix", finalToAmount: "100", fiatAmount: "100.00" });

    await expect(create({ brCode: PIX_CODE, paymentUrl: "https://skala.ripio.com/pix", expiresAt: "2098-12-31T23:00:00.000Z" })).resolves.toMatchObject({ instructions: { kind: "br-pix", brCode: PIX_CODE, expiresAt: "2098-12-31T23:00:00.000Z" } });
    await expect(create({ brCode: PIX_CODE, paymentUrl: null, expiresAt: null })).resolves.toMatchObject({ instructions: { kind: "br-pix", brCode: PIX_CODE } });
    const uppercaseGui = PIX_CODE.replace("br.gov.bcb.pix", "BR.GOV.BCB.PIX").replace("C027", "AAA4");
    await expect(create({ brCode: uppercaseGui })).resolves.toMatchObject({ instructions: { kind: "br-pix", brCode: uppercaseGui } });
    const lowercaseChecksum = PIX_CODE.replace("C027", "c027");
    await expect(create({ brCode: lowercaseChecksum })).resolves.toMatchObject({ instructions: { kind: "br-pix", brCode: lowercaseChecksum } });
    await expect(create({ brCode: PIX_CODE.replace("C027", "BEEF") })).rejects.toMatchObject({ code: "ambiguous-create" });
    for (const instructions of [
      {},
      { brCode: PIX_CODE.replace("5406100.00", "5406101.00") },
      { brCode: PIX_CODE.replace("5406100.00", "") },
      { brCode: `${PIX_CODE.slice(0, -1)}Z` },
      { brCode: PIX_CODE.replace("2632", "2699") },
      { brCode: PIX_CODE.replace("6004HOME6304C027", "6012HOME6304C027") },
      { cvu: "1234567890123456789012" },
      { brCode: PIX_CODE, paymentUrl: "http://skala.ripio.com/pix" },
      { brCode: PIX_CODE, expiresAt: "not-a-date" },
    ]) await expect(create(instructions)).rejects.toMatchObject({ code: "ambiguous-create" });
  });

  test("uses documented exact order retrieval instead of a paginated list filter", async () => {
    const urls: string[] = [];
    const client = createRipioClient("AR", { env, fetchImplementation: async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return token();
      return Response.json(productionTransaction({ latestRefund: { refundId: "55555555-5555-4555-8555-555555555555", status: "PENDING", rejectionReason: "", initiatedBy: "PARTNER", requestedAt: "2026-09-11T18:01:00Z" } }));
    } });
    expect((await client.getTransaction(ID)).latestRefund?.status).toBe("PENDING");
    expect(urls[1]).toBe(`https://skala.ripio.com/api/v1/transactions/${ID}/`);
  });

  test("accepts documented retrieval records with optional binding echoes omitted", async () => {
    const client = createRipioClient("AR", { env, fetchImplementation: async (_input, _init) => {
      if (_init?.method === "POST") return token();
      return Response.json({ transactionId: ID, status: "PENDING", txnHash: null, latestRefund: null });
    } });
    expect(await client.getTransaction(ID, expectedBinding)).toEqual({ transactionId: ID, status: "PENDING", txnHash: null, latestRefund: null });
  });

  test("rejects conflicting present production retrieval echoes and wrong order IDs", async () => {
    for (const conflict of [
      { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { quoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { fromCurrency: 123 },
      { source: "OFF_RAMP" },
      { depositAddress: "not-an-address" },
      { amount: "not-a-decimal" },
      { transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ]) {
      let calls = 0;
      const client = createRipioClient("AR", { env, fetchImplementation: async () => {
        calls += 1;
        return calls === 1 ? token() : Response.json(productionTransaction(conflict));
      } });
      await expect(client.getTransaction(ID, expectedBinding)).rejects.toBeInstanceOf(RipioProviderError);
    }
  });

  test("classifies exact retrieval 404 without attempting to parse the error record", async () => {
    let calls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => {
      calls += 1;
      return calls === 1 ? token() : Response.json({ detail: "not found" }, { status: 404 });
    } });
    await expect(client.getTransaction(ID)).rejects.toMatchObject({ code: "invalid-request", status: 404 });
    expect(calls).toBe(2);
  });

  test("rejects malformed successful retrieval records", async () => {
    let calls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => {
      calls += 1;
      return calls === 1 ? token() : Response.json({ transactionId: ID, status: 42, latestRefund: [] });
    } });
    await expect(client.getTransaction(ID)).rejects.toMatchObject({ code: "invalid-response" });
  });

  test("rejects unrelated create-response customer, quote, externalRef and destination bindings as ambiguous", async () => {
    let call = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => {
      call += 1;
      if (call === 1) return token();
      return Response.json({ transaction: productionTransaction({ customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), fiatPaymentInstructions: { cvu: "1234567890123456789012" } }, { status: 201 });
    } });
    await expect(client.createOnramp({ customerId: CUSTOMER, quoteId: QUOTE, externalRef: EXTERNAL, destination: DESTINATION, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", finalToAmount: "2100", fiatAmount: "2100" })).rejects.toMatchObject({ code: "ambiguous-create" });
    expect(call).toBe(2);
  });

  test("classifies a truncated successful create response as ambiguous and never retries", async () => {
    let calls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => {
      calls += 1;
      if (calls === 1) return token();
      return new Response('{"customerId":', { status: 201, headers: { "content-type": "application/json" } });
    } });
    await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "ambiguous-create" });
    expect(calls).toBe(2);
  });

  test("classifies uncertain create HTTP statuses as ambiguous after one create call", async () => {
    for (const status of [302, 408, 409, 422, 425, 429, 500, 503]) {
      let createCalls = 0;
      const client = createRipioClient("AR", { env, fetchImplementation: async (input) => {
        if (new URL(String(input)).pathname === "/oauth2/token/") return token();
        createCalls += 1;
        return new Response("uncertain", { status });
      } });
      await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "ambiguous-create", status });
      expect(createCalls).toBe(1);
    }
  });

  test("keeps the documented 400 validation response definitive", async () => {
    let createCalls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async (input) => {
      if (new URL(String(input)).pathname === "/oauth2/token/") return token();
      createCalls += 1;
      return new Response("validation rejected", { status: 400 });
    } });
    await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "invalid-request", status: 400 });
    expect(createCalls).toBe(1);
  });

  test("classifies disconnected creates as ambiguous and never retries", async () => {
    let calls = 0;
    const client = createRipioClient("AR", {
      env,
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return token();
        throw new Error("connection reset after write");
      },
    });
    await expect(client.createCustomer({ email: "person@example.com" })).rejects.toMatchObject({ code: "ambiguous-create" });
    expect(calls).toBe(2);
  });

  test("requires only a valid customer ID from customer creation", async () => {
    const create = (body: unknown) => createRipioClient("AR", { env, fetchImplementation: async (input) => new URL(String(input)).pathname === "/oauth2/token/" ? token() : Response.json(body) }).createCustomer({ email: "person@example.com" });
    await expect(create({ customerId: CUSTOMER })).resolves.toEqual({ customerId: CUSTOMER });
    await expect(create({ customerId: CUSTOMER, createdAt: "not-a-date", upstreamStatus: "ACTIVE" })).resolves.toEqual({ customerId: CUSTOMER });
    for (const body of [{}, { customerId: "not-a-uuid" }, { createdAt: "2026-09-18T00:00:00.000Z" }]) {
      await expect(create(body)).rejects.toMatchObject({ code: "ambiguous-create" });
    }
  });

  test("submits hosted KYC with exactly redirectUrl and ignores extra provider fields", async () => {
    const bodies: unknown[] = [];
    const client = createRipioClient("AR", { env, fetchImplementation: async (_input, init) => {
      if (!init?.body || String(init.body) === "grant_type=client_credentials") return token();
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ submissionId: ID, providerUrl: "https://kyc.ripio.com/start?token=synthetic", createdAt: "not-a-date", submissionState: "IN_REVIEW" });
    } });
    await expect(client.submitHostedKyc(CUSTOMER, { redirectUrl: "https://home.example/fund?return=verification" })).resolves.toEqual({ providerUrl: "https://kyc.ripio.com/start?token=synthetic" });
    expect(bodies).toEqual([{ redirectUrl: "https://home.example/fund?return=verification" }]);
  });

  test("requires only a bounded provider URL from hosted KYC", async () => {
    const submit = (body: unknown) => createRipioClient("AR", { env, fetchImplementation: async (_input, init) => String(init?.body) === "grant_type=client_credentials" ? token() : Response.json(body) }).submitHostedKyc(CUSTOMER, { redirectUrl: "https://home.example/fund?return=verification" });
    await expect(submit({ providerUrl: "https://kyc.ripio.com/start?token=synthetic" })).resolves.toEqual({ providerUrl: "https://kyc.ripio.com/start?token=synthetic" });
    for (const body of [
      {},
      { submissionId: ID, createdAt: "2026-09-18T00:00:00.000Z" },
      { providerUrl: 42 },
      { providerUrl: `https://kyc.ripio.com/${"x".repeat(5000)}` },
    ]) await expect(submit(body)).rejects.toMatchObject({ code: "ambiguous-create" });
  });

  test("retrieves the latest customer KYC submission requiring only the exact customer echo and a bounded status", async () => {
    const urls: string[] = [];
    const client = createRipioClient("AR", { env, fetchImplementation: async (input) => {
      urls.push(String(input));
      return urls.length === 1 ? token() : Response.json({ customerId: CUSTOMER, status: "COMPLETED" });
    } });
    await expect(client.getKycStatus(CUSTOMER)).resolves.toBe("COMPLETED");
    expect(urls[1]).toBe(`https://skala.ripio.com/api/v1/customers/${CUSTOMER}/kycSubmissions/`);
    const withExtras = createRipioClient("AR", { env, fetchImplementation: async (_input, init) => init?.method === "POST" ? token() : Response.json({ customerId: CUSTOMER, status: "IN_REVIEW", createdAt: "not-a-date", submissionId: ID }) });
    await expect(withExtras.getKycStatus(CUSTOMER)).resolves.toBe("IN_REVIEW");
    for (const payload of [
      { customerId: ID, status: "COMPLETED" },
      { customerId: CUSTOMER, status: 1 },
      { customerId: CUSTOMER, status: "" },
      { customerId: CUSTOMER, status: "x".repeat(129) },
    ]) {
      const malformed = createRipioClient("AR", { env, fetchImplementation: async (_input, init) => init?.method === "POST" ? token() : Response.json(payload) });
      await expect(malformed.getKycStatus(CUSTOMER)).rejects.toMatchObject({ code: "invalid-response" });
    }
  });
});
