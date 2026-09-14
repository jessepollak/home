import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { FundingCore } from "@/server/funding/core/service";
import { MemoryFundingOrderStore } from "@/server/funding/core/store";
import { describeFundingAdapter } from "@/server/funding/core/testing/describeFundingAdapter";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type {
  OrderIntent,
  QuoteIntent,
  ReconciliationIntent,
} from "@/shared/funding/provider-contract";
import { createCoinbaseProvider } from "./adapter";
import { coinbaseManifest } from "./manifest";

const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const PAYMENT_URL = "https://pay.coinbase.com/embedded/apple-pay";
const env = {
  CDP_API_KEY_ID: "synthetic-key-id",
  CDP_API_KEY_SECRET: "synthetic-key-secret",
};
const quoteIntent = {
  destination: DESTINATION,
  fiatAmount: "25",
  returnUrl: "https://home.example/fund?return=funding",
} satisfies QuoteIntent;
const intent = {
  homeOrderId: "11111111-1111-4111-8111-111111111111",
  destination: DESTINATION,
  fiatAmount: "25",
  quote: {
    fiatAmount: "25",
    tokenAmountAtomic: "24500000",
    fees: [{ label: "Coinbase fee", amount: "0.50", currency: "USD" }],
    feesKnown: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  returnUrl: "https://home.example/fund?return=funding",
} satisfies OrderIntent;
const reconciliationIntent = {
  providerOrderId: "synthetic-order-1",
  transactionType: "MINT",
  chainId: 8453,
  tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  destination: DESTINATION,
  expectedTokenAmountAtomic: "24500000",
  tokenDecimals: 6,
} satisfies ReconciliationIntent;

const provider = createCoinbaseProvider({
  generateJwtImplementation: async () => "synthetic-jwt",
});

function partnerUserRef(destination = DESTINATION, sandbox = false): string {
  const reference = createHash("sha256")
    .update(`home:${destination.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
  return sandbox ? `sandbox-${reference}` : reference;
}

function orderRecord(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "synthetic-order-1",
    status: "ONRAMP_ORDER_STATUS_PENDING_PAYMENT",
    paymentTotal: "25.50",
    paymentSubtotal: "25.00",
    paymentCurrency: "USD",
    paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
    purchaseAmount: "24.500000",
    purchaseCurrency: "USDC",
    fees: [{ type: "FEE_TYPE_EXCHANGE", amount: "0.50", currency: "USD" }],
    exchangeRate: "1",
    destinationAddress: DESTINATION,
    destinationNetwork: "base",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    partnerUserRef: partnerUserRef(),
    ...overrides,
  };
}

function quoteResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    source: "synthetic",
    order: orderRecord({
      paymentTotal: "25.00",
      paymentSubtotal: "24.50",
      ...overrides,
    }),
  }, { status: 201 });
}

function createResponse(
  orderOverrides: Record<string, unknown> = {},
  linkOverrides: Record<string, unknown> = {},
): Response {
  return Response.json({
    source: "synthetic",
    order: orderRecord(orderOverrides),
    paymentLink: {
      url: PAYMENT_URL,
      paymentLinkType: "PAYMENT_LINK_TYPE_APPLE_PAY_BUTTON",
      ...linkOverrides,
    },
  }, { status: 201 });
}

function statusResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    source: "synthetic",
    order: orderRecord(overrides),
  });
}

function context(
  fetchImplementation: typeof fetch,
  paymentMethodId = "apple-pay",
  sandbox = false,
) {
  return createProviderContext({
    manifest: coinbaseManifest,
    region: "US",
    paymentMethodId,
    env,
    fetchImplementation,
    sandbox,
  });
}

beforeEach(() => setObservabilityLogWriterForTests(() => undefined));
afterEach(() => setObservabilityLogWriterForTests());

describeFundingAdapter({
  provider,
  region: "US",
  paymentMethodId: "apple-pay",
  env,
  intent,
  successResponse: () => createResponse(),
  invalidCreateResponses: [
    {
      name: "purchase amount contradicts the signed quote",
      response: () => createResponse({ purchaseAmount: "24.499999" }),
    },
  ],
  unknownStatusResponse: () => statusResponse({
    status: "ONRAMP_ORDER_STATUS_UNSPECIFIED",
  }),
});

describe("Coinbase headless funding adapter", () => {
  test("declares one configured US USDC Apple Pay binding with quotes", () => {
    expect(coinbaseManifest.bindings).toEqual([
      {
        region: "US",
        assetId: "base:usdc",
        currency: "USD",
        directions: {
          onramp: {
            paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }],
            env: ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET"],
          },
        },
      },
    ]);
    expect(coinbaseManifest.onramp.sandbox).toBe(true);
    expect(coinbaseManifest.onramp.reference).toBe("provider");
    expect(coinbaseManifest.onramp.quotes).toBe(true);
    expect(coinbaseManifest.onramp.redirectOrigins).toEqual(["https://pay.coinbase.com"]);
  });

  test("creates a fee-bearing quote with a three-minute expiry and decimal-safe echoes", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const jwtOptions: unknown[] = [];
    const adapter = createCoinbaseProvider({
      generateJwtImplementation: async (options) => {
        jwtOptions.push(options);
        return "synthetic-jwt";
      },
    });
    const before = Date.now();
    const quote = await adapter.onramp!.createQuote!(
      quoteIntent,
      context((async (input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ url: String(input), init });
        return quoteResponse({ paymentTotal: "25.00" });
      }) as unknown as typeof fetch),
    );
    const after = Date.now();

    expect(jwtOptions).toEqual([{
      apiKeyId: env.CDP_API_KEY_ID,
      apiKeySecret: env.CDP_API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/onramp/orders",
      expiresIn: 120,
    }]);
    expect(requests[0]?.url).toBe("https://api.cdp.coinbase.com/platform/v2/onramp/orders");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      isQuote: true,
      paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
      paymentCurrency: "USD",
      paymentAmount: "25",
      purchaseCurrency: "USDC",
      destinationNetwork: "base",
      destinationAddress: DESTINATION,
      partnerUserRef: partnerUserRef(),
      domain: "home.example",
    });
    expect(quote).toMatchObject({
      fiatAmount: "25",
      tokenAmountAtomic: "24500000",
      fees: [{ label: "Coinbase fee", amount: "0.50", currency: "USD" }],
      feesKnown: true,
    });
    expect(Date.parse(quote.expiresAt)).toBeGreaterThanOrEqual(before + 180_000);
    expect(Date.parse(quote.expiresAt)).toBeLessThanOrEqual(after + 180_000);
  });

  test("rejects quote fee currencies and inconsistent fee equations", async () => {
    for (const response of [
      () => quoteResponse({
        fees: [{ type: "FEE_TYPE_EXCHANGE", amount: "0.50", currency: "EUR" }],
      }),
      () => quoteResponse({ paymentSubtotal: "24.49" }),
    ]) {
      const adapter = createCoinbaseProvider({
        generateJwtImplementation: async () => "synthetic-jwt",
      });
      await expect(adapter.onramp!.createQuote!(
        quoteIntent,
        context((async () => response()) as unknown as typeof fetch),
      )).rejects.toBeInstanceOf(Error);
    }
  });

  test("rejects quote payment-total drift and purchase amounts beyond six decimals", async () => {
    for (const response of [
      () => quoteResponse({ paymentTotal: "25.01", paymentSubtotal: "24.51" }),
      () => quoteResponse({ purchaseAmount: "24.5000001" }),
    ]) {
      await expect(provider.onramp!.createQuote!(
        quoteIntent,
        context((async () => response()) as unknown as typeof fetch),
      )).rejects.toBeInstanceOf(Error);
    }
  });

  test("pins purchaseAmount to the signed token amount and sends the Home reference", async () => {
    const requests: RequestInit[] = [];
    const result = await provider.onramp!.createOrder(
      intent,
      context((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push(init);
        return createResponse();
      }) as unknown as typeof fetch),
    );
    const body = JSON.parse(String(requests[0]?.body));
    expect(body).toEqual({
      paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
      paymentCurrency: "USD",
      purchaseAmount: "24.5",
      purchaseCurrency: "USDC",
      destinationNetwork: "base",
      destinationAddress: DESTINATION,
      partnerUserRef: partnerUserRef(),
      partnerOrderRef: intent.homeOrderId,
      domain: "home.example",
    });
    expect(body).not.toHaveProperty("paymentAmount");
    expect(body).not.toHaveProperty("isQuote");
    expect(result).toMatchObject({ outcome: "created" });
  });

  test("includes the core-supplied client IP only when present", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImplementation = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return createResponse();
    }) as unknown as typeof fetch;

    await provider.onramp!.createOrder({ ...intent, clientIp: "203.0.113.4" }, context(fetchImplementation));
    await provider.onramp!.createOrder(intent, context(fetchImplementation));

    expect(bodies[0]?.clientIp).toBe("203.0.113.4");
    expect(bodies[1]).not.toHaveProperty("clientIp");
  });

  test("uses Coinbase sandbox references and Apple Pay URL only when the core context is sandboxed", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const sandboxContext = context((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return requests.length === 1
        ? quoteResponse({ partnerUserRef: partnerUserRef(DESTINATION, true), status: "" })
        : createResponse({ partnerUserRef: partnerUserRef(DESTINATION, true) });
    }) as unknown as typeof fetch, "apple-pay", true);

    await provider.onramp!.createQuote!(quoteIntent, sandboxContext);
    const result = await provider.onramp!.createOrder(intent, sandboxContext);

    expect(requests[0]?.partnerUserRef).toBe(partnerUserRef(DESTINATION, true));
    expect(requests[1]?.partnerUserRef).toBe(partnerUserRef(DESTINATION, true));
    expect(result).toMatchObject({
      outcome: "created",
      order: {
        instructions: {
          kind: "embed",
          url: `${PAYMENT_URL}?useApplePaySandbox=true`,
        },
      },
    });

    const liveResult = await provider.onramp!.createOrder(
      intent,
      context((async () => createResponse()) as unknown as typeof fetch),
    );
    expect(liveResult).toMatchObject({
      outcome: "created",
      order: { instructions: { url: PAYMENT_URL } },
    });
  });

  test("rejects a missing quote before JWT generation or HTTP", async () => {
    let jwtCalls = 0;
    let httpCalls = 0;
    const adapter = createCoinbaseProvider({
      generateJwtImplementation: async () => {
        jwtCalls += 1;
        return "synthetic-jwt";
      },
    });
    const result = await adapter.onramp!.createOrder(
      { ...intent, quote: undefined },
      context((async () => {
        httpCalls += 1;
        return createResponse();
      }) as unknown as typeof fetch),
    );
    expect(result).toEqual({
      outcome: "rejected",
      message: "A current funding quote is required.",
    });
    expect(jwtCalls).toBe(0);
    expect(httpCalls).toBe(0);
  });

  test("rejects JWT generation failure before sending an order request", async () => {
    let httpCalls = 0;
    const adapter = createCoinbaseProvider({
      generateJwtImplementation: async () => {
        throw new Error("synthetic JWT failure");
      },
    });

    const result = await adapter.onramp!.createOrder(
      intent,
      context((async () => {
        httpCalls += 1;
        return createResponse();
      }) as unknown as typeof fetch),
    );

    expect(result).toEqual({
      outcome: "rejected",
      message: "Coinbase could not authorize this funding order.",
    });
    expect(httpCalls).toBe(0);
  });

  test("maps every contradictory create echo to ambiguous with one call", async () => {
    const cases: Array<{
      name: string;
      order?: Record<string, unknown>;
      link?: Record<string, unknown>;
    }> = [
      { name: "purchaseAmount", order: { purchaseAmount: "24.499999" } },
      { name: "destinationAddress", order: { destinationAddress: "0x2222222222222222222222222222222222222222" } },
      { name: "destinationNetwork", order: { destinationNetwork: "ethereum" } },
      { name: "purchaseCurrency", order: { purchaseCurrency: "EURC" } },
      { name: "partnerUserRef", order: { partnerUserRef: "wrong" } },
      { name: "payment link origin", link: { url: "https://evil.example/pay" } },
      { name: "payment link userinfo", link: { url: "https://user@pay.coinbase.com/pay" } },
      { name: "payment link hash", link: { url: "https://pay.coinbase.com/pay#secret" } },
      { name: "paymentLinkType", link: { paymentLinkType: "PAYMENT_LINK_TYPE_GENERIC" } },
    ];
    for (const scenario of cases) {
      let calls = 0;
      const result = await provider.onramp!.createOrder(
        intent,
        context((async () => {
          calls += 1;
          return createResponse(scenario.order, scenario.link);
        }) as unknown as typeof fetch),
      );
      expect(result, scenario.name).toEqual({ outcome: "ambiguous" });
      expect(calls, scenario.name).toBe(1);
    }
  });

  test("accepts the embedded-order payment link type observed live on 2026-09-13", async () => {
    const result = await provider.onramp!.createOrder(
      intent,
      context((async () => createResponse({}, {
        url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?sessionToken=synthetic",
        paymentLinkType: "PAYMENT_LINK_TYPE_EMBEDDED_ORDER",
      })) as unknown as typeof fetch),
    );

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(result.order.instructions.kind).toBe("embed");
    expect(new URL((result.order.instructions as { url: string }).url).pathname).toBe("/v3/api-onramp/embedded-order");
  });

  test("maps a create fee-equation mismatch to ambiguous after one call", async () => {
    let calls = 0;
    const result = await provider.onramp!.createOrder(
      intent,
      context((async () => {
        calls += 1;
        return createResponse({ paymentSubtotal: "25.01" });
      }) as unknown as typeof fetch),
    );

    expect(result).toEqual({ outcome: "ambiguous" });
    expect(calls).toBe(1);
  });

  test("classifies create HTTP and transport failures without retrying", async () => {
    const cases: Array<{
      name: string;
      response: () => Response | Promise<Response>;
      outcome: "rejected" | "ambiguous";
    }> = [
      { name: "400 errorType", response: () => Response.json({ source: "synthetic", errorType: "invalid" }, { status: 400 }), outcome: "rejected" },
      { name: "400 errorMessage", response: () => Response.json({ source: "synthetic", errorMessage: "invalid" }, { status: 400 }), outcome: "rejected" },
      { name: "400 empty JSON", response: () => Response.json({}, { status: 400 }), outcome: "ambiguous" },
      { name: "400 other JSON", response: () => Response.json({ source: "synthetic", error: "invalid" }, { status: 400 }), outcome: "ambiguous" },
      { name: "400 non-JSON", response: () => new Response("invalid", { status: 400 }), outcome: "ambiguous" },
      { name: "409", response: () => Response.json({ source: "synthetic" }, { status: 409 }), outcome: "ambiguous" },
      { name: "422", response: () => Response.json({ source: "synthetic" }, { status: 422 }), outcome: "ambiguous" },
      { name: "429", response: () => Response.json({ source: "synthetic" }, { status: 429 }), outcome: "ambiguous" },
      { name: "500", response: () => Response.json({ source: "synthetic" }, { status: 500 }), outcome: "ambiguous" },
      { name: "transport", response: async () => { throw new TypeError("synthetic transport"); }, outcome: "ambiguous" },
      { name: "oversized", response: () => new Response("{}", { status: 201, headers: { "content-length": String(64 * 1024 + 1) } }), outcome: "ambiguous" },
    ];
    for (const scenario of cases) {
      let calls = 0;
      const result = await provider.onramp!.createOrder(
        intent,
        context((async () => {
          calls += 1;
          return scenario.response();
        }) as unknown as typeof fetch),
      );
      expect(result.outcome, scenario.name).toBe(scenario.outcome);
      expect(calls, scenario.name).toBe(1);
    }
  });

  test("allows fiat repricing while surfacing the final total and order fees", async () => {
    const result = await provider.onramp!.createOrder(
      intent,
      context((async () => createResponse({
        paymentTotal: "26.25",
        paymentSubtotal: "25.50",
        fees: [
          { type: "FEE_TYPE_EXCHANGE", amount: "0.50", currency: "USD" },
          { type: "FEE_TYPE_NETWORK", amount: "0.25", currency: "USD" },
        ],
      })) as unknown as typeof fetch),
    );
    expect(result).toEqual({
      outcome: "created",
      order: {
        providerOrderId: "synthetic-order-1",
        tokenAddress: reconciliationIntent.tokenAddress,
        expectedTokenAmountAtomic: "24500000",
        fees: [
          { label: "Coinbase fee", amount: "0.50", currency: "USD" },
          { label: "Network fee", amount: "0.25", currency: "USD" },
        ],
        expiresAt: null,
        instructions: {
          kind: "embed",
          url: PAYMENT_URL,
          presentation: "apple-pay",
          amount: "26.25",
          currency: "USD",
        },
      },
    });
  });

  test("maps all Coinbase statuses and only exposes a 32-byte transaction hash", async () => {
    const cases = [
      ["ONRAMP_ORDER_STATUS_UNSPECIFIED", "unknown"],
      ["ONRAMP_ORDER_STATUS_PENDING_VERIFICATION", "awaiting-payment"],
      ["ONRAMP_ORDER_STATUS_PENDING_PAYMENT", "awaiting-payment"],
      ["ONRAMP_ORDER_STATUS_PROCESSING", "settling"],
      ["ONRAMP_ORDER_STATUS_COMPLETED", "sent"],
      ["ONRAMP_ORDER_STATUS_FAILED", "failed"],
      ["ONRAMP_ORDER_STATUS_CANCELLED", "cancelled"],
      ["ONRAMP_ORDER_STATUS_EXPIRED", "expired"],
    ] as const;
    for (const [status, expected] of cases) {
      const result = await provider.onramp!.getOrder(
        reconciliationIntent,
        context((async () => statusResponse({
          status,
          txHash: status === "ONRAMP_ORDER_STATUS_COMPLETED"
            ? `0x${"AB".repeat(32)}`
            : "not-a-hash",
        })) as unknown as typeof fetch),
      );
      expect(result.state, status).toBe(expected);
      if (status === "ONRAMP_ORDER_STATUS_COMPLETED") {
        expect(result.transactionHash).toBe(`0x${"ab".repeat(32)}`);
      } else {
        expect(result).not.toHaveProperty("transactionHash");
      }
    }
  });

  test("keeps every contradictory status echo and HTTP failure unknown", async () => {
    const mismatches = [
      { orderId: "other-order" },
      { destinationAddress: "0x2222222222222222222222222222222222222222" },
      { destinationNetwork: "ethereum" },
      { purchaseCurrency: "EURC" },
      { purchaseAmount: "24.499999" },
    ];
    for (const mismatch of mismatches) {
      const result = await provider.onramp!.getOrder(
        reconciliationIntent,
        context((async () => statusResponse(mismatch)) as unknown as typeof fetch),
      );
      expect(result.state).toBe("unknown");
    }
    await expect(provider.onramp!.getOrder(
      reconciliationIntent,
      context((async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch),
    )).resolves.toMatchObject({ state: "unknown" });
    await expect(provider.onramp!.getOrder(
      reconciliationIntent,
      context((async () => { throw new Error("synthetic transport"); }) as unknown as typeof fetch),
    )).resolves.toMatchObject({ state: "unknown" });
  });

  test("logs oversized quote bodies as provider transport failures", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));

    await expect(provider.onramp!.createQuote!(
      quoteIntent,
      context((async () => new Response("{}", {
        status: 201,
        headers: { "content-length": String(64 * 1024 + 1) },
      })) as unknown as typeof fetch),
    )).rejects.toBeInstanceOf(Error);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "funding-order",
      provider: "coinbase",
      code: "PROVIDER_TRANSPORT",
    });
  });

  test("emits only closed, scrubbed funding-order failure events", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    await provider.onramp!.createOrder(
      intent,
      context((async () => createResponse({ purchaseAmount: "1" })) as unknown as typeof fetch),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "funding-order",
      provider: "coinbase",
      code: "ORDER_ECHO_MISMATCH",
    });
    expect(lines[0]).not.toContain(DESTINATION);
    expect(lines[0]).not.toContain(PAYMENT_URL);
    expect(lines[0]).not.toContain(intent.quote.tokenAmountAtomic);
  });

  test("lists the binding only when both CDP API keys are configured", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "subject-a" },
      smartAccount: { address: DESTINATION, chainId: 8453 },
      accountProvider: "base-account",
    };
    const configured = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env,
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });
    const missingSecret = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env: { CDP_API_KEY_ID: env.CDP_API_KEY_ID },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });

    await expect(configured.listProviders("US", session)).resolves.toEqual([
      expect.objectContaining({
        providerId: "coinbase",
        region: "US",
        assetId: "base:usdc",
        quotes: true,
      }),
    ]);
    await expect(missingSecret.listProviders("US", session)).resolves.toEqual([]);
  });
});
