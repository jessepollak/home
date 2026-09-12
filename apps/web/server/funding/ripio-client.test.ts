import { describe, expect, test } from "bun:test";
import { createRipioClient, RipioProviderError, ripioCredentialState } from "./ripio-client";

const ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const EXTERNAL = "44444444-4444-4444-8444-444444444444";
const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const env = {
  RIPIO_CLIENT_ID_AR: "client-ar",
  RIPIO_CLIENT_SECRET_AR: "secret-ar-long-enough",
};

function token() {
  return Response.json({ access_token: "provider-access-token", expires_in: 36000, scope: "read write" });
}

function arCatalog() {
  return Response.json([{ network_name: "BASE", assets: [{ name: "wARS", contract_address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D" }] }]);
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

describe("Ripio production REST client", () => {
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
    expect(ripioCredentialState("AR", env)).toBe("configured");
    expect(ripioCredentialState("CO", env)).toBe("missing");
  });

  test("rejects cross-country/token/rail quote combinations before provider I/O", async () => {
    let calls = 0;
    const client = createRipioClient("AR", { env, fetchImplementation: async () => { calls += 1; return token(); } });
    await expect(client.createQuote({ country: "AR", fromCurrency: "ARS", toCurrency: "wCOP", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toBeInstanceOf(RipioProviderError);
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
    const quote = await client.createQuote({ country: "AR", fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION });
    expect(quote.fees[0]).toMatchObject({ amount: "10", appliesOnFromAmount: true });
    const order = await client.createOnramp({ customerId: CUSTOMER, quoteId: QUOTE, externalRef: EXTERNAL, destination: DESTINATION, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", finalToAmount: "2100" });
    expect(order.instructions).toEqual({ kind: "ar-bank-transfer", cvu: "1234567890123456789012", alias: "home.ripio" });
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
    await expect(client.createQuote({ country: "AR", fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: DESTINATION })).rejects.toMatchObject({ code: "invalid-request" });
    expect(calls).toBe(3);
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
    await expect(client.createOnramp({ customerId: CUSTOMER, quoteId: QUOTE, externalRef: EXTERNAL, destination: DESTINATION, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", finalToAmount: "2100" })).rejects.toMatchObject({ code: "ambiguous-create" });
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
});
