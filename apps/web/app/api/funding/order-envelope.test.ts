import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readFundingErrorResponse } from "@/shared/funding/contracts/errors";
import { readFundingOrderResponse, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { readVerificationHandoff, readFundingVerificationResponse, assertFundingProviderCustomersResponse, readFundingProviderCustomers } from "@/shared/funding/contracts/provider-customers";
import { assertFundingProvidersResponse, readProviderBindings } from "@/shared/funding/contracts/providers";
import { handleFundingOrderCancellationPost, handleFundingOrderGetById, handleFundingOrderPost, handleFundingOrderResolutionPost } from "@/server/funding/handlers/orders";
import { handleFundingQuotePost } from "@/server/funding/handlers/quotes";
import { handleFundingProviderCustomersGet } from "@/server/funding/handlers/provider-customers";
import { handleFundingVerificationPost } from "@/server/funding/handlers/provider-customers-verification";
import { handleFundingProvidersRequest } from "@/server/funding/handlers/providers";

function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("vary")).toContain("Authorization");
}

const roundTripSession: VerifiedAccountSession = {
  user: { subject: "funding-user" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const roundTripOrder = {
  id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", region: "AR",
  state: "awaiting-payment", fiatAmount: "100", providerStatus: null,
  quote: { fiatAmount: "100", tokenAmountAtomic: "1000", fees: [{ label: "Fee", amount: "1", currency: "ARS" }], expiresAt: "later" },
  instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "synthetic", amount: "101", currency: "ARS" },
} satisfies FundingOrderSummary;
test.each(["oversized", "content-length", "malformed", "empty", "aborted", "wrong-type", "missing-type"])("funding mutations reject %s bodies without invoking services", async (failure) => {
  const authorize = async () => roundTripSession;
  let calls = 0;
  const denyCall = async (): Promise<never> => { calls++; throw new Error("invalid body reached funding service"); };
  const mutations = [
    { code: "INVALID_QUOTE_REQUEST", message: "A valid funding request is required.", body: { region: "AR", providerId: "ripio", fiatAmount: "100" }, handle: (request: Request) => handleFundingQuotePost(request, { authorize, createQuote: denyCall }) },
    { code: "INVALID_VERIFICATION_REQUEST", message: "Valid verification details are required.", body: { providerId: "ripio", region: "AR", email: "customer@example.com" }, handle: (request: Request) => handleFundingVerificationPost(request, { authorize, startVerification: denyCall }) },
    { code: "INVALID_ORDER_REQUEST", message: "A valid quote token is required.", body: { quoteToken: "signed-token" }, handle: (request: Request) => handleFundingOrderPost(request, { authorize, createOrder: denyCall }) },
    { code: "INVALID_ORDER_RESOLUTION_REQUEST", message: "A valid resolution request is required.", body: { version: 1 }, handle: (request: Request) => handleFundingOrderResolutionPost(request, roundTripOrder.id, { authorize, resolveAmbiguousOrder: denyCall }) },
    { code: "INVALID_ORDER_CANCELLATION_REQUEST", message: "A valid cancellation request is required.", body: { version: 1 }, handle: (request: Request) => handleFundingOrderCancellationPost(request, roundTripOrder.id, { authorize, cancelOrder: denyCall }) },
  ];
  for (const mutation of mutations) {
    const body = JSON.stringify(mutation.body);
    const headers = new Headers();
    if (failure !== "missing-type") headers.set("content-type", failure === "wrong-type" ? "text/plain" : "application/json");
    if (failure === "content-length") headers.set("content-length", String(64 * 1024 + 1));
    const input = new Request("https://home.example/api/funding", {
      method: "POST",
      headers,
      signal: failure === "aborted" ? AbortSignal.abort() : undefined,
      body: failure === "oversized" ? " ".repeat(64 * 1024) + body : failure === "malformed" ? "{" : failure === "empty" ? undefined : new TextEncoder().encode(body),
    });
    const response = await mutation.handle(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: mutation.code, message: mutation.message } });
    assertPrivate(response);
    expect(input.body?.locked ?? false).toBe(false);
  }
  expect(calls).toBe(0);
});

const orderMethods = [
  {
    method: "POST", status: 201,
    handle: (order: unknown) => handleFundingOrderPost(new Request("https://home.example/api/funding/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"quoteToken":"signed-token"}',
    }), { authorize: async () => roundTripSession, createOrder: async () => order }),
  },
  {
    method: "GET", status: 200,
    handle: (order: unknown) => handleFundingOrderGetById(new Request(`https://home.example/api/funding/orders/${roundTripOrder.id}`),
      roundTripOrder.id, { authorize: async () => roundTripSession, getOrder: async () => order }),
  },
];

test.each(orderMethods)("funding order $method handler round-trips through the strict client reader", async ({ handle, status }) => {
  const response = await handle(roundTripOrder);
  expect(response.status).toBe(status);
  assertPrivate(response);
  const body = await response.json();
  expect(body).toEqual({ version: 1, order: roundTripOrder });
  expect(readFundingOrderResponse(body)).toEqual(roundTripOrder);
});

test.each(orderMethods)("funding order $method rejects malformed nested handler output", async ({ handle }) => {
  for (const override of [
    { instructions: { ...roundTripOrder.instructions, accountNumber: 123 } },
    { quote: { ...roundTripOrder.quote, fees: [{ label: "Fee", amount: 1, currency: "ARS" }] } },
    { fees: [{ label: "Fee", amount: "1", currency: null }] },
  ]) {
    const response = await handle({ ...roundTripOrder, ...override });
    expect(response.status).toBe(503);
    assertPrivate(response);
    const body = await response.json();
    expect(readFundingOrderResponse(body)).toBeNull();
    expect(readFundingErrorResponse(body)).toEqual({ error: { code: "ORDER_UNAVAILABLE", message: "The funding order is unavailable." } });
  }
});

const verificationCustomer = { providerId: "ripio", region: "AR", state: "pending" as const, verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" };

test("verification handler round-trips its versioned customer and handoff through the client parser", async () => {
  const url = "https://kyc.example.com/start?token=synthetic";
  const response = await handleFundingVerificationPost(new Request("https://home.example/api/funding/provider-customers/verification", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"providerId":"ripio","region":"AR","email":"customer@example.com"}',
  }), { authorize: async () => roundTripSession, startVerification: async () => ({ customer: verificationCustomer, handoff: { url } }) });
  expect(response.status).toBe(201);
  assertPrivate(response);
  const body = await response.json();
  expect(body).toEqual({ version: 1, customer: verificationCustomer, handoff: { url } });
  expect(readFundingVerificationResponse(body)).toEqual({ customer: verificationCustomer, handoff: { url } });
  expect(readVerificationHandoff(body)).toBe(url);
});

test("verification handler fails closed on malformed service output", async () => {
  for (const output of [
    { customer: { ...verificationCustomer, state: "unknown" } },
    { customer: { ...verificationCustomer, updatedAt: null } },
    { customer: verificationCustomer, handoff: { url: 42 } },
    { handoff: { url: "https://kyc.example.com/start" } },
    { version: 2, customer: verificationCustomer },
  ]) {
    const response = await handleFundingVerificationPost(new Request("https://home.example/api/funding/provider-customers/verification", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"providerId":"ripio","region":"AR","email":"customer@example.com"}',
    }), { authorize: async () => roundTripSession, startVerification: async () => output });
    expect(response.status).toBe(503);
    assertPrivate(response);
    const body = await response.json();
    expect(readFundingVerificationResponse(body)).toBeNull();
    expect(readFundingErrorResponse(body)).toEqual({ error: { code: "VERIFICATION_UNAVAILABLE", message: "Verification is unavailable." } });
  }
});

test("provider discovery returns a client-parsable binding and rejects another region", async () => {
  const binding = {
    direction: "onramp" as const, providerId: "ripio", displayName: "Ripio", region: "AR",
    assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS",
    paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: { hosted: true as const },
    resumeOnly: false,
  };
  const dependencies = (providers: readonly unknown[]) => ({
    authorize: async () => roundTripSession, databaseUrl: "postgres://configured", listProviders: async () => providers,
  });
  const response = await handleFundingProvidersRequest(new Request("https://home.example/api/funding/providers?region=AR&direction=onramp"), dependencies([binding]));
  expect(response.status).toBe(200);
  assertPrivate(response);
  const body = await response.json();
  assertFundingProvidersResponse(body, "onramp", "AR");
  expect(readProviderBindings(body)).toEqual([binding]);
  const foreign = await handleFundingProvidersRequest(new Request("https://home.example/api/funding/providers?region=AR&direction=onramp"), dependencies([{ ...binding, region: "BR" }]));
  expect(foreign.status).toBe(503);
  assertPrivate(foreign);
  expect(await foreign.json()).toEqual({ error: { code: "PROVIDERS_UNAVAILABLE", message: "Funding methods are unavailable." } });
});

test("provider-customer GET returns a client-parsable customer and rejects another region", async () => {
  const customer = { providerId: "ripio", region: "AR", state: "verified" as const, verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" };
  const dependencies = (customers: readonly unknown[]) => ({ authorize: async () => roundTripSession, listProviderCustomers: async () => customers });
  const response = await handleFundingProviderCustomersGet(new Request("https://home.example/api/funding/provider-customers?region=AR"), dependencies([customer]));
  expect(response.status).toBe(200);
  assertPrivate(response);
  const body = await response.json();
  assertFundingProviderCustomersResponse(body, "AR");
  expect(readFundingProviderCustomers(body)).toEqual([customer]);
  const foreign = await handleFundingProviderCustomersGet(new Request("https://home.example/api/funding/provider-customers?region=AR"), dependencies([{ ...customer, region: "BR" }]));
  expect(foreign.status).toBe(503);
  assertPrivate(foreign);
  expect(await foreign.json()).toEqual({ error: { code: "CUSTOMERS_UNAVAILABLE", message: "Provider setup is unavailable." } });
});
