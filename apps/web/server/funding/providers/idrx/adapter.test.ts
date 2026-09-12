import { describe, expect, test } from "bun:test";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { describeFundingAdapter } from "@/server/funding/core/testing/describeFundingAdapter";
import type {
  OrderIntent,
  ReconciliationIntent,
} from "@/shared/funding/provider-contract";
import bindingMismatchesFixture from "./fixtures/binding-mismatches.synthetic.json";
import createErrorsFixture from "./fixtures/create-errors.synthetic.json";
import createQrisFixture from "./fixtures/create-qris.synthetic.json";
import createVaFixture from "./fixtures/create-va.synthetic.json";
import historyUnknownFixture from "./fixtures/history-unknown.synthetic.json";
import { createIdrxSignature, idrxProvider } from "./adapter";

const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const env = {
  IDRX_CLIENT_ID: "synthetic-public-key",
  IDRX_CLIENT_SECRET: Buffer.from("synthetic-secret").toString("base64"),
  IDRX_CUSTOMER_NAME: "HOME TEST CUSTOMER",
};
const intent = {
  homeOrderId: "home-order-must-not-be-used-as-idrx-reference",
  destination: DESTINATION,
  fiatAmount: "20000.50",
  returnUrl: "https://home.example/funding/return",
} satisfies OrderIntent;
const reconciliationIntent = {
  providerOrderId: "synthetic-order-1",
  transactionType: "MINT",
  chainId: 8453,
  tokenAddress: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
  destination: DESTINATION,
  expectedTokenAmountAtomic: "2000050",
  tokenDecimals: 2,
} satisfies ReconciliationIntent;

function jsonFixture(value: unknown): Response {
  return Response.json(value);
}

function createResponseWithEchoes(
  fixture: { data: Record<string, unknown> },
  echoes: Record<string, unknown>,
): Response {
  return jsonFixture({
    source: "synthetic",
    statusCode: 200,
    message: "success",
    data: { ...fixture.data, ...echoes },
  });
}

function historyRecord(
  overrides: Record<string, unknown> = {},
  paymentMethodId = "qris",
) {
  const channel = paymentMethodId === "bank-va-mandiri"
    ? "MANDIRI"
    : paymentMethodId === "bank-va-bri"
      ? "BRI"
      : null;
  return {
    merchantOrderId: reconciliationIntent.providerOrderId,
    providerOrderId: reconciliationIntent.providerOrderId,
    orderId: reconciliationIntent.providerOrderId,
    reference: `SNAP-${reconciliationIntent.providerOrderId}`,
    transactionType: "MINT",
    txType: "MINT",
    requestType: "idrx",
    chainId: reconciliationIntent.chainId,
    networkChainId: String(reconciliationIntent.chainId),
    tokenAddress: reconciliationIntent.tokenAddress,
    tokenSymbol: "IDRX",
    tokenDecimals: reconciliationIntent.tokenDecimals,
    destinationWalletAddress: reconciliationIntent.destination,
    destinationAddress: reconciliationIntent.destination,
    toBeMinted: "20000.50",
    baseAmount: "20000.50",
    amount: "20001.00",
    fees: [{ name: "Synthetic fee", amount: "0.50", currency: "IDR" }],
    tokenAmountAtomic: reconciliationIntent.expectedTokenAmountAtomic,
    paymentMethod: channel ? "va" : "qris",
    rail: channel ? "bank-va" : "qris",
    ...(channel ? { channelId: channel } : {}),
    userMintStatus: "MINTED",
    paymentStatus: "PAID",
    txHash: `0x${"ab".repeat(32)}`,
    transactionHash: `0x${"ab".repeat(32)}`,
    ...overrides,
  };
}

describeFundingAdapter({
  provider: idrxProvider,
  region: "ID",
  paymentMethodId: "bank-va-mandiri",
  env,
  intent,
  successResponse: () => jsonFixture(createVaFixture),
  invalidCreateResponses: bindingMismatchesFixture.createVa.map(
    ({ name, echoes }) => ({
      name,
      response: () => createResponseWithEchoes(createVaFixture, echoes),
    }),
  ),
  unknownStatusResponse: () => jsonFixture(historyUnknownFixture),
});

describeFundingAdapter({
  provider: idrxProvider,
  region: "ID",
  paymentMethodId: "qris",
  env,
  intent,
  successResponse: () => jsonFixture(createQrisFixture),
  invalidCreateResponses: bindingMismatchesFixture.createQris.map(
    ({ name, echoes }) => ({
      name,
      response: () => createResponseWithEchoes(createQrisFixture, echoes),
    }),
  ),
  unknownStatusResponse: () => jsonFixture(historyUnknownFixture),
});

describe("IDRX adapter behavior", () => {
  test("keeps every committed provider fixture explicitly synthetic", () => {
    expect(bindingMismatchesFixture.source).toBe("synthetic");
    expect(createVaFixture.source).toBe("synthetic");
    expect(createQrisFixture.source).toBe("synthetic");
    expect(createErrorsFixture.source).toBe("synthetic");
    expect(historyUnknownFixture.source).toBe("synthetic");
  });

  test("matches the fixed published IDRX HMAC helper vector exactly", () => {
    const body =
      '{"toBeMinted":"20000","destinationWalletAddress":"0x1111111111111111111111111111111111111111","networkChainId":"8453","requestType":"idrx","expiryPeriod":60,"paymentMethod":"va","channelId":"MANDIRI"}';
    expect(createIdrxSignature({
      method: "POST",
      url: "https://api.idrx.co/transaction/mint-request",
      body,
      timestamp: "1700000000000",
      secretKey: Buffer.from("idrx-test-secret").toString("base64"),
    })).toBe("TIiWEY8ESCqHQPv9XL0zEmpSYU7kdePmhIetvKvuxn8");
  });

  test("classifies only documented no-order errors as rejected and never retries", async () => {
    for (const fixture of createErrorsFixture.cases) {
      if (fixture.outcome !== "ambiguous" && fixture.outcome !== "rejected") {
        throw new Error("Invalid synthetic classification fixture.");
      }
      let calls = 0;
      const ctx = createProviderContext({
        manifest: idrxProvider.manifest,
        region: "ID",
        paymentMethodId: "bank-va-mandiri",
        env,
        fetchImplementation: (async () => {
          calls += 1;
          return Response.json({
            source: "synthetic",
            statusCode: fixture.status,
            message: fixture.message,
          }, { status: fixture.status });
        }) as unknown as typeof fetch,
      });
      const result = await idrxProvider.createOrder(intent, ctx);
      expect(result.outcome, fixture.name).toBe(fixture.outcome);
      expect(calls, fixture.name).toBe(1);
    }
  });

  test("keeps provider-assigned references and HMAC-signed rail details behind the adapter", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const ctx = createProviderContext({
      manifest: idrxProvider.manifest,
      region: "ID",
      paymentMethodId: "bank-va-bri",
      env,
      fetchImplementation: (async (
        input: RequestInfo | URL,
        init: RequestInit = {},
      ) => {
        requests.push({ url: String(input), init });
        return jsonFixture({
          ...createVaFixture,
          data: {
            ...createVaFixture.data,
            channelId: "BRI",
            fees: [{ name: "VA BRI", amount: "4000.00" }],
          },
        });
      }) as unknown as typeof fetch,
    });

    const result = await idrxProvider.createOrder(intent, ctx);
    expect(result.outcome).toBe("created");
    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]?.init.body));
    expect(body).toEqual({
      toBeMinted: "20000.50",
      destinationWalletAddress: DESTINATION,
      networkChainId: "8453",
      requestType: "idrx",
      expiryPeriod: 60,
      paymentMethod: "va",
      channelId: "BRI",
    });
    expect(JSON.stringify(body)).not.toContain(intent.homeOrderId);
    const headers = new Headers(requests[0]?.init.headers);
    expect(headers.get("idrx-api-key")).toBe(env.IDRX_CLIENT_ID);
    expect(headers.get("idrx-api-sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (result.outcome === "created") {
      expect(result.order).toMatchObject({
        providerOrderId: "synthetic-order-1",
        expectedTokenAmountAtomic: "2000050",
        instructions: {
          kind: "bank-transfer",
          rail: "virtual-account",
          bank: "BRI",
          amount: "24000.50",
          currency: "IDR",
        },
      });
    }
  });

  test("requires a checkout URL for QRIS while accepting documented URL-free VA", async () => {
    const qrisData: Record<string, unknown> = { ...createQrisFixture.data };
    delete qrisData.checkoutUrl;
    delete qrisData.paymentUrl;
    delete qrisData.instructionUrl;
    const cases = [
      {
        paymentMethodId: "qris",
        response: { ...createQrisFixture, data: qrisData },
        outcome: "ambiguous",
      },
      {
        paymentMethodId: "bank-va-mandiri",
        response: createVaFixture,
        outcome: "created",
      },
    ] as const;
    for (const scenario of cases) {
      const ctx = createProviderContext({
        manifest: idrxProvider.manifest,
        region: "ID",
        paymentMethodId: scenario.paymentMethodId,
        env,
        fetchImplementation: (async () =>
          jsonFixture(scenario.response)) as unknown as typeof fetch,
      });
      const result = await idrxProvider.createOrder(intent, ctx);
      expect(result.outcome).toBe(scenario.outcome);
    }
  });

  test("accepts coherent optional QRIS amount and fee echoes", async () => {
    const ctx = createProviderContext({
      manifest: idrxProvider.manifest,
      region: "ID",
      paymentMethodId: "qris",
      env,
      fetchImplementation: (async () => createResponseWithEchoes(
        createQrisFixture,
        {
          baseAmount: "20000.50",
          amount: "20001.00",
          fees: [{ name: "QRIS", amount: "0.50" }],
        },
      )) as unknown as typeof fetch,
    });
    const result = await idrxProvider.createOrder(intent, ctx);
    expect(result).toMatchObject({
      outcome: "created",
      order: { fees: [{ label: "QRIS", amount: "0.50", currency: "IDR" }] },
    });
  });

  test("accepts matching QRIS and VA history rail echoes", async () => {
    for (const paymentMethodId of ["qris", "bank-va-mandiri"] as const) {
      const ctx = createProviderContext({
        manifest: idrxProvider.manifest,
        region: "ID",
        paymentMethodId,
        env,
        fetchImplementation: (async () => Response.json({
          source: "synthetic",
          records: [historyRecord({}, paymentMethodId)],
        })) as unknown as typeof fetch,
      });
      await expect(idrxProvider.getOrder(reconciliationIntent, ctx)).resolves.toMatchObject({
        state: "sent",
      });
    }
  });

  test("maps documented history states without ever reporting received", async () => {
    const cases = [
      ["MINTED", "PAID", "sent"],
      ["PROCESSING", "PAID", "settling"],
      ["NOT_AVAILABLE", "WAITING_FOR_PAYMENT", "awaiting-payment"],
      ["NOT_AVAILABLE", "EXPIRED", "expired"],
      ["REJECTED", "PAID", "failed"],
      ["REFUND", "PAID", "refunded"],
      ["FAILED", "PAID", "unknown"],
      ["NEW_STATUS", "PAID", "unknown"],
    ] as const;
    for (const [userMintStatus, paymentStatus, expected] of cases) {
      const ctx = createProviderContext({
        manifest: idrxProvider.manifest,
        region: "ID",
        paymentMethodId: "qris",
        env,
        fetchImplementation: (async () => Response.json({
          source: "synthetic",
          records: [historyRecord({ userMintStatus, paymentStatus })],
        })) as unknown as typeof fetch,
      });
      const observation = await idrxProvider.getOrder(reconciliationIntent, ctx);
      expect(observation.state).toBe(expected);
      expect(observation.state).not.toBe("received");
    }
  });

  test("keeps every reproduced contradictory reconciliation echo unresolved", async () => {
    for (const fixture of bindingMismatchesFixture.history) {
      let calls = 0;
      const records = fixture.duplicate
        ? [
            historyRecord({}, fixture.paymentMethodId),
            historyRecord(fixture.overrides, fixture.paymentMethodId),
          ]
        : [historyRecord(fixture.overrides, fixture.paymentMethodId)];
      const ctx = createProviderContext({
        manifest: idrxProvider.manifest,
        region: "ID",
        paymentMethodId: fixture.paymentMethodId,
        env,
        fetchImplementation: (async () => {
          calls += 1;
          return Response.json({ source: "synthetic", records });
        }) as unknown as typeof fetch,
      });
      const observation = await idrxProvider.getOrder(reconciliationIntent, ctx);
      expect(observation.state, fixture.name).toBe("unknown");
      expect(calls, fixture.name).toBe(1);
    }
  });

  test("fails closed on a redirect outside the manifest allowlist", async () => {
    const ctx = createProviderContext({
      manifest: idrxProvider.manifest,
      region: "ID",
      paymentMethodId: "qris",
      env,
      fetchImplementation: (async () => Response.json({
        source: "synthetic",
        data: {
          merchantOrderId: "synthetic-order-1",
          checkoutUrl: "https://evil.example/?token=leak",
        },
      })) as unknown as typeof fetch,
    });
    await expect(idrxProvider.createOrder(intent, ctx)).resolves.toEqual({
      outcome: "ambiguous",
    });
  });

  test("bounds declared and streamed oversized provider bodies", async () => {
    const oversizedResponses = [
      () => new Response("{}", {
        status: 200,
        headers: { "content-length": String(64 * 1024 + 1) },
      }),
      () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(64 * 1024 + 1));
          controller.close();
        },
      }), { status: 200 }),
    ];
    for (const response of oversizedResponses) {
      const ctx = createProviderContext({
        manifest: idrxProvider.manifest,
        region: "ID",
        paymentMethodId: "qris",
        env,
        fetchImplementation: (async () => response()) as unknown as typeof fetch,
      });
      await expect(idrxProvider.createOrder(intent, ctx)).resolves.toEqual({
        outcome: "ambiguous",
      });
    }
  });

  test("bounds a stalled provider response body", async () => {
    let cancellations = 0;
    const ctx = createProviderContext({
      manifest: idrxProvider.manifest,
      region: "ID",
      paymentMethodId: "qris",
      env,
      fetchImplementation: (async () => new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancellations += 1;
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch,
    });
    const startedAt = performance.now();
    await expect(idrxProvider.createOrder(intent, ctx)).resolves.toEqual({
      outcome: "ambiguous",
    });
    expect(performance.now() - startedAt).toBeLessThan(8_000);
    expect(cancellations).toBe(1);
  }, 10_000);

  test("rejects unsupported precision before an outbound request", async () => {
    let calls = 0;
    const ctx = createProviderContext({
      manifest: idrxProvider.manifest,
      region: "ID",
      paymentMethodId: "qris",
      env,
      fetchImplementation: (async () => {
        calls += 1;
        return jsonFixture(createQrisFixture);
      }) as unknown as typeof fetch,
    });
    await expect(idrxProvider.createOrder(
      { ...intent, fiatAmount: "20000.501" },
      ctx,
    )).resolves.toMatchObject({ outcome: "rejected" });
    expect(calls).toBe(0);
  });
});
