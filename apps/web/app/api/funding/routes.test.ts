import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { createElement, useEffect } from "react";
import type { OwnerGenerationFence } from "@/client/account/owner-generation-fence";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readFundingErrorResponse } from "@/shared/funding/contracts/errors";
import { assertFundingProvidersResponse, FUNDING_PROVIDERS_VERSION, readProviderBindings } from "@/shared/funding/contracts/providers";
import { assertFundingOpenOrderResponse, FUNDING_OPEN_ORDER_VERSION, readFundingOpenOrderResponse } from "@/shared/funding/contracts/open-order";
import { fundingProviders } from "@/server/funding/providers";
import { useAuthenticatedTransport } from "@/client/account/cdp-authenticated-transport";
import { render } from "@testing-library/react";
import { GET as providers } from "./providers/route";
import { handleFundingProvidersRequest } from "./providers/handler";
import { POST as quotes } from "./quotes/route";
import { handleFundingQuotePost } from "./quotes/handler";
import { GET as openOrders, POST as createOrder } from "./orders/route";
import { GET as orderStatus } from "./orders/[id]/route";
import { POST as resolveOrder } from "./orders/[id]/resolve/route";
import { GET as providerCustomers } from "./provider-customers/route";
import { handleFundingProviderCustomersGet } from "./provider-customers/handler";
import { POST as startProviderCustomerVerification } from "./provider-customers/verification/route";
import { POST as webhook } from "./webhooks/[provider]/route";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import {
  handleFundingOpenOrderGet,
  handleFundingOrderGetById,
  handleFundingOrderPost,
  handleFundingOrderResolutionPost,
} from "./orders/handler";
import { FundingCoreError } from "@/server/funding/core/service";
import { assertFundingProviderCustomersResponse } from "@/shared/funding/contracts/provider-customers";

function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("vary")).toContain("Authorization");
}

describe("funding route privacy and rejection", () => {
  test("returns no providers when funding persistence is not configured", async () => {
    let listCalls = 0;
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
          },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: undefined,
        listProviders: async () => {
          listCalls += 1;
          return [];
        },
      },
    );

    expect(response.status).toBe(200);
    assertPrivate(response);
    const body = await response.json();
    assertFundingProvidersResponse(body, "onramp", "AR");
    expect(body).toEqual({
      version: FUNDING_PROVIDERS_VERSION,
      direction: "onramp",
      providers: [],
    });
    expect(listCalls).toBe(0);
  });

  test("on-ramp provider discovery returns a client-parsable binding", async () => {
    const binding = {
      direction: "onramp", providerId: "ripio", displayName: "Ripio", region: "AR",
      assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS",
      paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: { hosted: true },
      resumeOnly: false,
    };
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR&direction=onramp"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async () => [binding],
      },
    );
    expect(response.status).toBe(200);
    assertPrivate(response);
    const body = await response.json();
    assertFundingProvidersResponse(body, "onramp", "AR");
    expect(body.providers).toEqual([binding]);
  });

  test("fails closed when provider discovery serves another region's binding", async () => {
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR&direction=onramp"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async () => [{
          direction: "onramp", providerId: "ripio", displayName: "Ripio", region: "BR",
          assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS",
          paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: { hosted: true },
        }],
      },
    );
    expect(response.status).toBe(503);
    assertPrivate(response);
    expect(await response.json()).toEqual({ error: { code: "PROVIDERS_UNAVAILABLE", message: "Funding methods are unavailable." } });
  });

  test("provider-customer GET returns a client-parsable customer", async () => {
    const customer = { providerId: "ripio", region: "AR", state: "verified", verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" };
    const response = await handleFundingProviderCustomersGet(
      new Request("https://home.example/api/funding/provider-customers?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        listProviderCustomers: async () => [customer],
      },
    );
    expect(response.status).toBe(200);
    assertPrivate(response);
    const body = await response.json();
    assertFundingProviderCustomersResponse(body, "AR");
    expect(body.customers).toEqual([customer]);
  });

  test("fails closed when provider-customer GET serves another region's customer", async () => {
    const response = await handleFundingProviderCustomersGet(
      new Request("https://home.example/api/funding/provider-customers?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        listProviderCustomers: async () => [{ providerId: "ripio", region: "BR", state: "verified", verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" }],
      },
    );
    expect(response.status).toBe(503);
    assertPrivate(response);
    expect(await response.json()).toEqual({ error: { code: "CUSTOMERS_UNAVAILABLE", message: "Provider setup is unavailable." } });
  });

  test("open-order GET returns a client-parsable order with complete instructions", async () => {
    const order = {
      id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", region: "ID",
      state: "awaiting-payment", fiatAmount: "20000", providerStatus: null,
      instructions: { kind: "redirect" as const, url: "https://checkout.idrx.co/?token=synthetic" },
    };
    const response = await handleFundingOpenOrderGet(
      new Request("https://home.example/api/funding/orders?region=ID"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        getOpenOrder: async () => order,
      },
    );
    expect(response.status).toBe(200);
    assertPrivate(response);
    const body = await response.json();
    assertFundingOpenOrderResponse(body, "ID");
    expect(body).toEqual({ version: FUNDING_OPEN_ORDER_VERSION, order });
  });

  test("fails closed when the open-order GET serves another region's order", async () => {
    const response = await handleFundingOpenOrderGet(
      new Request("https://home.example/api/funding/orders?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        getOpenOrder: async () => ({
          id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", region: "ID",
          state: "awaiting-payment", fiatAmount: "20000", providerStatus: null, instructions: null,
        }),
      },
    );
    expect(response.status).toBe(503);
    assertPrivate(response);
    expect(await response.json()).toEqual({ error: { code: "ORDER_UNAVAILABLE", message: "The funding order is unavailable." } });
  });

  test.each([
    ["null fee", { fees: [null] }],
    ["non-string atomic amount", { expectedTokenAmountAtomic: { amount: "2000000" } }],
    ["partial quote", { quote: { fiatAmount: "20000" } }],
  ])("fails closed when the open-order GET serves a malformed %s", async (_case, fields) => {
    const response = await handleFundingOpenOrderGet(
      new Request("https://home.example/api/funding/orders?region=ID"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        getOpenOrder: async () => ({
          id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", region: "ID",
          state: "awaiting-payment", fiatAmount: "20000", providerStatus: null,
          instructions: { kind: "redirect", url: "https://example.com/pay" },
          ...fields,
        }),
      },
    );
    expect(response.status).toBe(503);
    assertPrivate(response);
    expect(await response.json()).toEqual({ error: { code: "ORDER_UNAVAILABLE", message: "The funding order is unavailable." } });
  });

  test("passes the requested funding direction to provider discovery", async () => {
    let requestedDirection: string | undefined;
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=US&direction=offramp"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
          },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async (_region, _session, direction) => {
          requestedDirection = direction;
          return [];
        },
      },
    );

    expect(response.status).toBe(200);
    assertPrivate(response);
    expect(requestedDirection).toBe("offramp");
    const body = await response.json();
    assertFundingProvidersResponse(body, "offramp", "US");
    expect(body).toEqual({
      version: FUNDING_PROVIDERS_VERSION,
      direction: "offramp",
      providers: [],
    });
  });

  test("parses paused and ordinary bindings from the providers route and drops malformed entries", async () => {
    const paused = {
      providerId: "ripio", displayName: "Ripio", direction: "onramp" as const, region: "AR",
      assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS",
      paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }],
      quotes: true, customerSetup: null, resumeOnly: true,
    };
    const ordinary = { ...paused, providerId: "coinbase", displayName: "Coinbase", resumeOnly: false };
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR&direction=onramp"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async () => [paused, ordinary],
      },
    );
    expect(response.status).toBe(200);
    assertPrivate(response);
    const body = await response.json();
    assertFundingProvidersResponse(body, "onramp", "AR");
    expect(body.version).toBe(FUNDING_PROVIDERS_VERSION);
    const bindings = readProviderBindings(body);
    expect(bindings).toEqual([paused, ordinary]);
    const malformedBindings = [
      { ...paused, providerId: "malformed", resumeOnly: "true" },
      { ...paused, providerId: "invalid-method", paymentMethods: [{ id: 42, label: "Invalid" }] },
    ];
    expect(readProviderBindings({ ...body, providers: [paused, ordinary, ...malformedBindings] })).toEqual([paused, ordinary]);
    for (const malformed of malformedBindings) {
      const rejected = await handleFundingProvidersRequest(
        new Request("https://home.example/api/funding/providers?region=AR&direction=onramp"),
        {
          authorize: async () => ({
            user: { subject: "funding-user" },
            smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
            accountProvider: "cdp-embedded",
          }),
          databaseUrl: "postgres://configured",
          listProviders: async () => [paused, ordinary, malformed],
        },
      );
      expect(rejected.status).toBe(503);
      assertPrivate(rejected);
      expect(readFundingErrorResponse(await rejected.json())?.error.code).toBe("PROVIDERS_UNAVAILABLE");
    }
    const selected = bindings[0];
    if (!selected) throw new Error("expected a parsed provider binding");
    const method = selected.paymentMethods[0];
    if (!method) throw new Error("expected a parsed payment method");
    const orderResponse = await handleFundingOpenOrderGet(
      new Request(`https://home.example/api/funding/orders?region=${selected.region}&providerId=${selected.providerId}&paymentMethod=${method.id}&assetId=${encodeURIComponent(selected.assetId)}`),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        getOpenOrder: async (_session, region, providerId, paymentMethod, assetId) => {
          expect([region, providerId, paymentMethod, assetId]).toEqual([selected.region, selected.providerId, method.id, selected.assetId]);
          return { id: "11111111-1111-4111-8111-111111111111", region, providerId, paymentMethod, assetId,
            state: "dispatch-ambiguous", fiatAmount: "100", providerStatus: null, instructions: null };
        },
      },
    );
    expect(orderResponse.status).toBe(200);
    assertPrivate(orderResponse);
    const orderBody = await orderResponse.json();
    assertFundingOpenOrderResponse(orderBody, selected.region);
    expect(readFundingOpenOrderResponse(orderBody)?.order).toMatchObject({ providerId: selected.providerId, paymentMethod: method.id });
  });

  test("keeps provider-list failures visible as a transient service error", async () => {
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
          },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async () => {
          throw new Error("database unavailable");
        },
      },
    );

    expect(response.status).toBe(503);
    assertPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "PROVIDERS_UNAVAILABLE",
        message: "Funding methods are unavailable.",
      },
    });
  });

  test("rejects a session without a smart account with private headers", async () => {
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=US"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: null,
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: undefined,
        listProviders: async () => [],
      },
    );

    expect(response.status).toBe(403);
    assertPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "SMART_ACCOUNT_UNAVAILABLE",
        message: "A verified Base account is required.",
      },
    });
  });

  test("rejects every unauthenticated funding route with private no-store", async () => {
    for (const [, invoke] of [
    ["providers", () => providers(new Request("https://home.example/api/funding/providers?region=ID"))],
    ["quotes", () => quotes(new Request("https://home.example/api/funding/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ["open orders", () => openOrders(new Request("https://home.example/api/funding/orders?region=ID"))],
    ["create order", () => createOrder(new Request("https://home.example/api/funding/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ["order status", () => orderStatus(new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) })],
    ["resolve order", () => resolveOrder(new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"version":1}' }), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) })],
    ["provider customers", () => providerCustomers(new Request("https://home.example/api/funding/provider-customers?region=AR"))],
    ["start provider customer verification", () => startProviderCustomerVerification(new Request("https://home.example/api/funding/provider-customers/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ] as const) {
      const response = await invoke();
      expect(response.ok).toBe(false);
      assertPrivate(response);
    }
  });

  test("parses a real funding route session-boundary rejection", async () => {
    const response = await providers(new Request("https://home.example/api/funding/providers?region=ID"));
    expect(response.status).toBe(401);
    assertPrivate(response);
    expect(readFundingErrorResponse(await response.json())).toEqual({
      error: { code: "UNAUTHENTICATED", message: "A valid access token is required." },
    });
  });

  test("provider-scoped open-order reads keep the response shape and reject malformed provider ids", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "funding-user" },
      smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
      accountProvider: "cdp-embedded",
    };
    const calls: Array<[string, string | undefined, string | undefined, string | undefined]> = [];
    const dependencies = {
      authorize: async () => session,
      getOpenOrder: async (_session: VerifiedAccountSession, region: string, providerId?: string, paymentMethod?: string, assetId?: string) => {
        calls.push([region, providerId, paymentMethod, assetId]);
        const summary = { region, state: "awaiting-payment", fiatAmount: "100", providerStatus: null, instructions: null };
        return providerId === "idrx"
          ? paymentMethod === "bank" ? { ...summary, id: "newer-idrx-bank", providerId, paymentMethod }
            : { ...summary, id: "older-idrx-qris", providerId, paymentMethod: "qris" }
          : { ...summary, id: "newer-coinbase", providerId: "coinbase" };
      },
    };
    for (const [method, id] of [["qris", "older-idrx-qris"], ["bank", "newer-idrx-bank"]] as const) {
      const scoped = await handleFundingOpenOrderGet(new Request(`https://home.example/api/funding/orders?region=ID&providerId=idrx&paymentMethod=${method}`), dependencies);
      expect(scoped.status).toBe(200);
      assertPrivate(scoped);
      const body = await scoped.json();
      assertFundingOpenOrderResponse(body, "ID");
      expect(body).toEqual({ version: FUNDING_OPEN_ORDER_VERSION, order: { region: "ID", state: "awaiting-payment", fiatAmount: "100", providerStatus: null, instructions: null, id, providerId: "idrx", paymentMethod: method } });
      expect(readFundingOpenOrderResponse(body)).toEqual(body);
    }
    const ordinary = await handleFundingOpenOrderGet(new Request("https://home.example/api/funding/orders?region=ID"), dependencies);
    const ordinaryBody = await ordinary.json();
    expect(ordinary.status).toBe(200);
    assertPrivate(ordinary);
    assertFundingOpenOrderResponse(ordinaryBody, "ID");
    expect(ordinaryBody).toEqual({ version: FUNDING_OPEN_ORDER_VERSION, order: { region: "ID", state: "awaiting-payment", fiatAmount: "100", providerStatus: null, instructions: null, id: "newer-coinbase", providerId: "coinbase" } });
    expect(readFundingOpenOrderResponse(ordinaryBody)).toEqual(ordinaryBody);
    const empty = await handleFundingOpenOrderGet(new Request("https://home.example/api/funding/orders?region=ID"), { ...dependencies, getOpenOrder: async () => null });
    expect(empty.status).toBe(200);
    assertPrivate(empty);
    const emptyBody = await empty.json();
    assertFundingOpenOrderResponse(emptyBody, "ID");
    expect(readFundingOpenOrderResponse(emptyBody)).toEqual({ version: FUNDING_OPEN_ORDER_VERSION, order: null });
    for (const malformed of ["", "UPPERCASE", "invalid!", "2provider", "provider_id", "x".repeat(33)]) {
      const response = await handleFundingOpenOrderGet(new Request(`https://home.example/api/funding/orders?region=ID&providerId=${encodeURIComponent(malformed)}`), dependencies);
      expect(response.status).toBe(400);
      expect(readFundingErrorResponse(await response.json())?.error.code).toBe("INVALID_ORDER_REQUEST");
    }
    for (const malformed of ["", "INVALID", "bad!", "bank.transfer", "x".repeat(33)]) {
      const response = await handleFundingOpenOrderGet(new Request(`https://home.example/api/funding/orders?region=ID&providerId=idrx&paymentMethod=${encodeURIComponent(malformed)}`), dependencies);
      expect(response.status).toBe(400);
      expect(readFundingErrorResponse(await response.json())?.error.code).toBe("INVALID_ORDER_REQUEST");
    }
    for (const scope of ["providerId=idrx&assetId=BASE%3Aidrx", "assetId=base%3Aidrx"]) {
      const response = await handleFundingOpenOrderGet(new Request(`https://home.example/api/funding/orders?region=ID&${scope}`), dependencies);
      expect(response.status).toBe(400);
      assertPrivate(response);
      expect(readFundingErrorResponse(await response.json())?.error).toEqual({
        code: "INVALID_ORDER_REQUEST", message: "Choose a valid funding asset.",
      });
    }
    const missingProvider = await handleFundingOpenOrderGet(new Request("https://home.example/api/funding/orders?region=ID&paymentMethod=qris"), dependencies);
    expect(missingProvider.status).toBe(400);
    assertPrivate(missingProvider);
    expect(readFundingErrorResponse(await missingProvider.json())?.error.code).toBe("INVALID_ORDER_REQUEST");
    expect(calls).toEqual([["ID", "idrx", "qris", undefined], ["ID", "idrx", "bank", undefined], ["ID", undefined, undefined, undefined]]);
  });

  test("every manifest payment method round-trips through the scoped order route", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "funding-user" },
      smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
      accountProvider: "cdp-embedded",
    };
    const methods = fundingProviders.flatMap((provider) => provider.manifest.bindings.flatMap((binding) =>
      [...(binding.directions.onramp?.paymentMethods ?? []), ...(binding.directions.offramp?.paymentMethods ?? [])]
        .map((method) => ({ providerId: provider.manifest.id, region: binding.region, method: method.id }))));
    expect(methods.length).toBeGreaterThan(0);
    for (const { providerId, region, method } of methods) {
      const response = await handleFundingOpenOrderGet(
        new Request(`https://home.example/api/funding/orders?region=${region}&providerId=${providerId}&paymentMethod=${method}`),
        {
          authorize: async () => session,
          getOpenOrder: async (_session, requestedRegion, requestedProvider, requestedMethod, assetId) => {
            expect([requestedRegion, requestedProvider, requestedMethod, assetId]).toEqual([region, providerId, method, undefined]);
            return { id: "11111111-1111-4111-8111-111111111111", providerId: requestedProvider,
              region: requestedRegion, paymentMethod: requestedMethod, state: "dispatch-ambiguous",
              fiatAmount: "100", providerStatus: null, instructions: null };
          },
        },
      );
      expect(response.status).toBe(200);
      assertPrivate(response);
      const body = await response.json();
      assertFundingOpenOrderResponse(body, region);
      expect(readFundingOpenOrderResponse(body)).toMatchObject({
        version: FUNDING_OPEN_ORDER_VERSION, order: { providerId, region, paymentMethod: method },
      });
    }
  });

  test("validates and resolves the versioned ambiguous-order command", async () => {
    const session = {
      user: { subject: "funding-user" },
      smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
      accountProvider: "cdp-embedded" as const,
    };
    let calls = 0;
    const dependencies = {
      authorize: async () => session,
      resolveAmbiguousOrder: async () => {
        calls += 1;
        return {
          id: "11111111-1111-4111-8111-111111111111",
          providerId: "idrx",
          state: "cancelled",
          fiatAmount: "20000",
          providerStatus: null,
          instructions: null,
        };
      },
    };
    const id = "11111111-1111-4111-8111-111111111111";

    for (const request of [
      new Request(`https://home.example/api/funding/orders/${id}/resolve`, { method: "POST", body: "{}" }),
      new Request(`https://home.example/api/funding/orders/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
      new Request(`https://home.example/api/funding/orders/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"version":2}' }),
    ]) {
      const response = await handleFundingOrderResolutionPost(request, id, dependencies);
      expect(response.status).toBe(400);
      assertPrivate(response);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_ORDER_RESOLUTION_REQUEST" },
      });
    }
    expect(calls).toBe(0);

    const response = await handleFundingOrderResolutionPost(
      new Request(`https://home.example/api/funding/orders/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"version":1}',
      }),
      id,
      dependencies,
    );
    expect(response.status).toBe(200);
    assertPrivate(response);
    expect(await response.json()).toMatchObject({
      version: 1,
      order: { id, state: "cancelled" },
    });
    expect(calls).toBe(1);
  });

  test("the Fund client's error reader preserves paused quote and order handler messages", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "funding-user" },
      smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
      accountProvider: "cdp-embedded",
    };
    const message = "Peer is no longer offered here.";
    const quoteResponse = await handleFundingQuotePost(new Request("https://home.example/api/funding/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"providerId":"peer","region":"US","paymentMethod":"bank","fiatAmount":"100"}',
    }), {
      authorize: async () => session,
      createQuote: async () => { throw new FundingCoreError("CORRIDOR_NOT_OFFERED", 409, undefined, message); },
    });
    const orderResponse = await handleFundingOrderPost(new Request("https://home.example/api/funding/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"quoteToken":"signed-token"}',
    }), {
      authorize: async () => session,
      createOrder: async () => { throw new FundingCoreError("CORRIDOR_NOT_OFFERED", 409, undefined, message); },
    });
    for (const response of [quoteResponse, orderResponse]) {
      expect(response.status).toBe(409);
      assertPrivate(response);
      expect(readFundingErrorResponse(await response.clone().json())).toEqual({
        error: { code: "CORRIDOR_NOT_OFFERED", message },
      });
    }
    const ownerFence: OwnerGenerationFence = {
      capture: () => 0, isCurrent: () => true, advance: () => 0,
      assertCurrent: () => {}, updateAuthorizationBoundary: () => {}, updateOwnerKey: () => false,
    };
    const transportReady = Promise.withResolvers<ReturnType<typeof useAuthenticatedTransport>>();
    function TransportProbe() {
      const transport = useAuthenticatedTransport({
        session, status: "verified", verification: "server", ownerKey: "owner", ownerFence,
        getAccessToken: async () => null, authentication: "native-base",
        sessionFetch: async (path) => String(path).includes("/quotes") ? quoteResponse.clone() : orderResponse.clone(),
      });
      useEffect(() => { transportReady.resolve(transport); }, [transport]);
      return null;
    }
    const page = render(createElement(TransportProbe));
    try {
      const transport = await transportReady.promise;
      for (const path of ["/api/funding/quotes", "/api/funding/orders"]) {
        await expect(transport.fetchAccountResource(path, { method: "POST", body: { quoteToken: "signed-token" } })).rejects.toMatchObject({
          kind: "http", status: 409, code: "CORRIDOR_NOT_OFFERED", serverMessage: message,
        });
      }
    } finally {
      page.unmount();
    }
  });

  test("returns the paused corridor message in the order creation wire error", async () => {
    const response = await handleFundingOrderPost(new Request("https://home.example/api/funding/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"quoteToken":"signed-token"}',
    }), {
      authorize: async () => ({ user: { subject: "funding-user" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" }),
      createOrder: async () => { throw new FundingCoreError("CORRIDOR_NOT_OFFERED", 409, undefined, "Peer is no longer offered here."); },
    });
    expect(response.status).toBe(409);
    assertPrivate(response);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "CORRIDOR_NOT_OFFERED", message: "Peer is no longer offered here." } });
    expect(readFundingErrorResponse(body)).toEqual({
      error: { code: "CORRIDOR_NOT_OFFERED", message: "Peer is no longer offered here." },
    });
  });

  test("returns the ambiguous-order recovery deadline", async () => {
    const availableAt = "2026-09-13T00:05:00.000Z";
    const id = "11111111-1111-4111-8111-111111111111";
    const response = await handleFundingOrderResolutionPost(
      new Request(`https://home.example/api/funding/orders/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"version":1}',
      }),
      id,
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
          accountProvider: "cdp-embedded",
        }),
        resolveAmbiguousOrder: async () => {
          throw new FundingCoreError("ORDER_RESOLUTION_NOT_READY", 409, availableAt);
        },
      },
    );

    expect(response.status).toBe(409);
    assertPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "ORDER_RESOLUTION_NOT_READY",
        message: "This order can be cleared after Sep 13, 2026, 12:05 AM UTC.",
      },
    });
  });

  test("omits unknown provider attribution from each funding order route catch path", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    try {
      const session = {
        user: { subject: "funding-user" },
        smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
        accountProvider: "cdp-embedded" as const,
      };
      const fail = async (): Promise<never> => { throw new Error("store unavailable"); };
      const dependencies = {
        authorize: async () => session,
        createOrder: fail,
        getOpenOrder: fail,
        getOrder: fail,
        resolveAmbiguousOrder: fail,
      };
      const responses = await Promise.all([
        handleFundingOrderPost(new Request("https://home.example/api/funding/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteToken: "synthetic-token" }),
        }), dependencies),
        handleFundingOpenOrderGet(
          new Request("https://home.example/api/funding/orders?region=ID"),
          dependencies,
        ),
        handleFundingOrderGetById(
          new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111"),
          "11111111-1111-4111-8111-111111111111",
          dependencies,
        ),
        handleFundingOrderResolutionPost(
          new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: '{"version":1}',
          }),
          "11111111-1111-4111-8111-111111111111",
          dependencies,
        ),
      ]);

      expect(responses.map((response) => response.status)).toEqual([503, 503, 503, 503]);
      expect(lines).toHaveLength(4);
      const eventRoutes = lines.map(
        (line) => (JSON.parse(line) as Record<string, unknown>).route,
      );
      expect(eventRoutes.filter((route) => route === "/api/funding/orders")).toHaveLength(2);
      expect(eventRoutes.filter((route) => route === "/api/funding/orders/:redacted")).toHaveLength(1);
      expect(eventRoutes.filter((route) => route === "/api/funding/orders/:redacted/resolve")).toHaveLength(1);
      for (const line of lines) {
        const event = JSON.parse(line) as Record<string, unknown>;
        expect(event).toMatchObject({ kind: "funding-order", code: "ORDER_UNAVAILABLE", ownerHash: expect.any(String) });
        expect(event).not.toHaveProperty("provider");
        expect(line).not.toContain("cdp-embedded");
        expect(line).not.toContain("funding-user");
      }
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("invalid webhook remains private and acknowledged", async () => {
    const response = await webhook(new Request("https://home.example/api/funding/webhooks/ripio", { method: "POST", body: "invalid" }), { params: Promise.resolve({ provider: "ripio" }) });
    expect(response.status).toBe(202);
    assertPrivate(response);
    expect(await response.json()).toMatchObject({ accepted: true });
  });
});
