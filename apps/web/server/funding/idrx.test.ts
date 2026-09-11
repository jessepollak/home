import { describe, expect, test } from "bun:test";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import {
  IDRX_API_BASE_URL,
  IDRX_BASE_ADDRESS,
  IDRX_DECIMALS,
  IDRX_HISTORY_MAX_RESPONSE_BYTES,
  IDRX_HISTORY_PAGE,
  IDRX_HISTORY_TAKE,
  IDRX_MINT_PATH,
  IdrxMintError,
  assertIdrxBaseToken,
  createIdrxMintClient,
  createIdrxMintStatusReader,
  isAllowedIdrxMintAmount,
  parseIdrxCheckoutUrl,
  resolveConfiguredIdrxCustomer,
} from "./idrx";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CHECKOUT = "https://checkout.idrx.co/?token=eyJhbGciOi.fixture";
const SECRET = Buffer.from("idrx-test-secret").toString("base64");

function vaData(overrides: Record<string, unknown> = {}) {
  return {
    statusCode: 200,
    message: "success",
    data: {
      id: 1234,
      merchantOrderId: "20260728130000",
      reference: "SNAP-20260728130000",
      checkoutUrl: CHECKOUT,
      paymentUrl: CHECKOUT,
      paymentMethod: "va",
      virtualAccountNo: "8680770000001234",
      virtualAccountName: "JOHN SMITH",
      amount: 24000,
      baseAmount: 20000,
      fees: [{ name: "VA Mandiri", amount: 4000 }],
      expiredDate: "2026-07-28T14:00:00.000Z",
      ...overrides,
    },
  };
}

function hostedData() {
  return {
    statusCode: 200,
    message: "success",
    data: {
      id: 1234,
      merchantOrderId: "20260728130000",
      reference: "SNAP-20260728130000",
      checkoutUrl: CHECKOUT,
      paymentUrl: CHECKOUT,
    },
  };
}

const HISTORY_ORDER = "20260911130000";
const HISTORY_INTENT = {
  destinationWalletAddress: ADDRESS,
  networkChainId: 8453 as const,
  toBeMinted: "20000",
};
const historyEnvironment = {
  IDRX_CLIENT_ID: "public-key",
  IDRX_CLIENT_SECRET: SECRET,
  IDRX_CUSTOMER_SUBJECT: "subject-a",
  IDRX_CUSTOMER_NAME: "JOHN SMITH",
};

function historyRecord(overrides: Record<string, unknown> = {}) {
  return {
    transactionType: "MINT",
    id: 456,
    merchantOrderId: HISTORY_ORDER,
    requestType: "idrx",
    chainId: 8453,
    destinationWalletAddress: ADDRESS,
    toBeMinted: "20000.00",
    amount: "24000.00",
    userMintStatus: "MINTED",
    paymentStatus: "PAID",
    transactionHash: `0x${"a".repeat(64)}`,
    createdAt: "2026-09-11T13:00:00.000Z",
    updatedAt: "2026-09-11T13:01:00.000Z",
    ...overrides,
  };
}

function historyPayload(records: unknown[]) {
  return {
    statusCode: 200,
    message: "success",
    metadata: {
      totalPages: 1,
      currentPage: IDRX_HISTORY_PAGE,
      nextPage: null,
      prevPage: null,
    },
    records,
  };
}

function readHistory(
  payload: unknown,
  options: { timeoutMs?: number; merchantOrderId?: string } = {},
) {
  const reader = createIdrxMintStatusReader({
    env: historyEnvironment,
    timeoutMs: options.timeoutMs,
    fetchImplementation: async () => Response.json(payload),
  });
  return reader({
    customer: { subject: "subject-a", customerName: "JOHN SMITH" },
    merchantOrderId: options.merchantOrderId ?? HISTORY_ORDER,
    intent: HISTORY_INTENT,
  });
}

describe("IDRX mint client", () => {
  test("binds Base 8453 IDRX (2 decimals) and prefers VA Flow B", async () => {
    expect(assertIdrxBaseToken()).toEqual({
      id: "idrx",
      symbol: "IDRX",
      decimals: 2,
      tokenAddress: IDRX_BASE_ADDRESS,
    });
    expect(verifiedLocalCashAssets.IDR.decimals).toBe(IDRX_DECIMALS);
    expect(verifiedLocalCashAssets.IDR.contractAddress.toLowerCase()).toBe(
      IDRX_BASE_ADDRESS.toLowerCase(),
    );

    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const client = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET, IDRX_CUSTOMER_SUBJECT: "subject-a", IDRX_CUSTOMER_NAME: "JOHN SMITH" },
      now: () => 1_700_000_000_000,
      fetchImplementation: async (input, init) => {
        requests.push({ input: String(input), init });
        return Response.json(vaData());
      },
    });

    const result = await client({
      address: ADDRESS,
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      toBeMinted: "20000",
      rail: "bank-va",
      channelId: "MANDIRI",
      returnUrl: "https://home.example/fund?return=idrx",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(`${IDRX_API_BASE_URL}${IDRX_MINT_PATH}`);
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("idrx-api-key")).toBe("public-key");
    expect(headers.get("idrx-api-ts")).toBe("1700000000000");
    expect(headers.get("idrx-api-sig")).toBeTruthy();
    expect(headers.get("User-Agent")).toBe("home/idrx-mint");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      toBeMinted: "20000",
      destinationWalletAddress: ADDRESS,
      networkChainId: "8453",
      requestType: "idrx",
      expiryPeriod: 60,
      paymentMethod: "va",
      channelId: "MANDIRI",
    });
    expect(result).toEqual({
      presentation: "virtual-account",
      rail: "bank-va",
      asset: {
        id: "idrx",
        symbol: "IDRX",
        decimals: 2,
        tokenAddress: IDRX_BASE_ADDRESS,
      },
      network: { name: "Base", chainId: 8453 },
      merchantOrderId: "20260728130000",
      reference: "SNAP-20260728130000",
      virtualAccountNo: "8680770000001234",
      virtualAccountName: "JOHN SMITH",
      amount: "24000",
      baseAmount: "20000",
      fees: [{ name: "VA Mandiri", amount: "4000" }],
      expiredDate: "2026-07-28T14:00:00.000Z",
      channelId: "MANDIRI",
      verification: { status: "pending", boundary: "balance-and-activity" },
    });
  });

  test("binds customer-specific credentials to the verified Home subject and VA name", async () => {
    expect(resolveConfiguredIdrxCustomer("subject-a", {
      IDRX_CLIENT_ID: "public-key",
      IDRX_CLIENT_SECRET: SECRET,
      IDRX_CUSTOMER_SUBJECT: "subject-a",
      IDRX_CUSTOMER_NAME: "JOHN SMITH",
    })).toEqual({ subject: "subject-a", customerName: "JOHN SMITH" });
    expect(resolveConfiguredIdrxCustomer("subject-b", {
      IDRX_CLIENT_ID: "public-key",
      IDRX_CLIENT_SECRET: SECRET,
      IDRX_CUSTOMER_SUBJECT: "subject-a",
      IDRX_CUSTOMER_NAME: "JOHN SMITH",
    })).toBeNull();

    let providerCalls = 0;
    const client = createIdrxMintClient({
      env: {
        IDRX_CLIENT_ID: "public-key",
        IDRX_CLIENT_SECRET: SECRET,
        IDRX_CUSTOMER_SUBJECT: "subject-a",
        IDRX_CUSTOMER_NAME: "JOHN SMITH",
      },
      fetchImplementation: async () => {
        providerCalls += 1;
        return Response.json(vaData());
      },
    });
    await expect(client({
      address: ADDRESS,
      customer: { subject: "subject-b", customerName: "JANE SMITH" },
      toBeMinted: "20000",
      rail: "bank-va",
      channelId: "MANDIRI",
      returnUrl: "https://home.example/fund?return=idrx",
    })).rejects.toMatchObject({ code: "not-configured" });
    expect(providerCalls).toBe(0);
  });

  test("queries bounded MINT history and classifies only documented compatible states", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const statuses = [
      ["MINTED", "PAID", "minted"],
      ["REJECTED", "PAID", "failed"],
      ["REFUND", "PAID", "failed"],
      ["FAILED", "PAID", "failed"],
      ["PROCESSING", "PAID", "pending"],
      ["NOT_AVAILABLE", "WAITING_FOR_PAYMENT", "pending"],
      ["NOT_AVAILABLE", "EXPIRED", "expired"],
    ] as const;
    const reader = createIdrxMintStatusReader({
      env: historyEnvironment,
      now: () => 1_700_000_000_000,
      fetchImplementation: async (input, init) => {
        requests.push({ input: String(input), init });
        const [mintStatus, paymentStatus] = statuses[requests.length - 1]!;
        return Response.json(historyPayload([
          historyRecord({ userMintStatus: mintStatus, paymentStatus }),
        ]));
      },
    });
    for (const [, , expected] of statuses) {
      await expect(reader({
        customer: { subject: "subject-a", customerName: "JOHN SMITH" },
        merchantOrderId: HISTORY_ORDER,
        intent: HISTORY_INTENT,
      })).resolves.toBe(expected);
    }
    expect(requests).toHaveLength(statuses.length);
    expect(requests[0]?.init?.method).toBe("GET");
    expect(requests[0]?.init?.body).toBeUndefined();
    const query = new URL(requests[0]!.input).searchParams;
    expect(query.get("transactionType")).toBe("MINT");
    expect(query.get("page")).toBe(String(IDRX_HISTORY_PAGE));
    expect(query.get("take")).toBe(String(IDRX_HISTORY_TAKE));
    expect(query.get("merchantOrderId")).toBe(HISTORY_ORDER);
  });

  test("keeps missing, duplicate, contradictory, unsupported, wrong-order, and wrong-intent evidence unresolved", async () => {
    const unresolved = [
      historyPayload([]),
      historyPayload([historyRecord(), historyRecord({ id: 457 })]),
      historyPayload([historyRecord({ paymentStatus: "WAITING_FOR_PAYMENT" })]),
      historyPayload([historyRecord({ userMintStatus: "COMPLETED" })]),
      historyPayload([historyRecord({ merchantOrderId: "different-order" })]),
      historyPayload([historyRecord({ chainId: 1 })]),
      historyPayload([historyRecord({
        destinationWalletAddress: "0x2222222222222222222222222222222222222222",
      })]),
      historyPayload([historyRecord({ toBeMinted: "20000.01" })]),
      historyPayload([historyRecord({ userMintStatus: null })]),
    ];
    for (const payload of unresolved) {
      await expect(readHistory(payload)).resolves.toBe("pending");
    }
  });

  test("bounds history headers, body, payload size, and record count independently", async () => {
    const stalledHeaders = createIdrxMintStatusReader({
      env: historyEnvironment,
      timeoutMs: 10,
      fetchImplementation: async () => new Promise<Response>(() => {}),
    });
    await expect(stalledHeaders({
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      merchantOrderId: HISTORY_ORDER,
      intent: HISTORY_INTENT,
    })).rejects.toMatchObject({ code: "unavailable" });

    const stalledBody = createIdrxMintStatusReader({
      env: historyEnvironment,
      timeoutMs: 10,
      fetchImplementation: async () => new Response(new ReadableStream({
        pull: async () => new Promise<void>(() => {}),
      })),
    });
    await expect(stalledBody({
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      merchantOrderId: HISTORY_ORDER,
      intent: HISTORY_INTENT,
    })).rejects.toMatchObject({ code: "unavailable" });

    const malformed = createIdrxMintStatusReader({
      env: historyEnvironment,
      fetchImplementation: async () => new Response("{"),
    });
    await expect(malformed({
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      merchantOrderId: HISTORY_ORDER,
      intent: HISTORY_INTENT,
    })).rejects.toMatchObject({ code: "invalid-response" });
    await expect(readHistory(historyPayload(
      Array.from({ length: IDRX_HISTORY_TAKE + 1 }, (_, index) =>
        historyRecord({ id: index, merchantOrderId: `other-${index}` })
      ),
    ))).rejects.toMatchObject({ code: "invalid-response" });

    const oversized = createIdrxMintStatusReader({
      env: historyEnvironment,
      fetchImplementation: async () => new Response(
        JSON.stringify({ records: [], padding: "x".repeat(IDRX_HISTORY_MAX_RESPONSE_BYTES) }),
      ),
    });
    await expect(oversized({
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      merchantOrderId: HISTORY_ORDER,
      intent: HISTORY_INTENT,
    })).rejects.toMatchObject({ code: "invalid-response" });
  });

  test("creates QRIS only through the explicit hosted rail", async () => {
    const bodies: unknown[] = [];
    const client = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET, IDRX_CUSTOMER_SUBJECT: "subject-a", IDRX_CUSTOMER_NAME: "JOHN SMITH" },
      now: () => 1_700_000_000_000,
      fetchImplementation: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json(hostedData());
      },
    });

    const result = await client({
      address: ADDRESS,
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      toBeMinted: "20000.00",
      rail: "qris",
      returnUrl: "https://home.example/fund?return=idrx",
    });

    expect(bodies).toEqual([{
      toBeMinted: "20000.00",
      destinationWalletAddress: ADDRESS,
      networkChainId: "8453",
      returnUrl: "https://home.example/fund?return=idrx",
      expiryPeriod: 60,
      requestType: "idrx",
    }]);
    expect(result).toMatchObject({
      presentation: "hosted",
      rail: "qris",
      merchantOrderId: "20260728130000",
      url: CHECKOUT,
      verification: { status: "pending", boundary: "balance-and-activity" },
    });
  });

  test("accepts documented numeric response amounts with up to two decimals", async () => {
    const client = createIdrxMintClient({
      env: {
        IDRX_CLIENT_ID: "public-key",
        IDRX_CLIENT_SECRET: SECRET,
        IDRX_CUSTOMER_SUBJECT: "subject-a",
        IDRX_CUSTOMER_NAME: "JOHN SMITH",
      },
      fetchImplementation: async () => new Response(
        '{"statusCode":200,"data":{"merchantOrderId":"20260728130000","reference":"SNAP-20260728130000","virtualAccountNo":"8680770000001234","virtualAccountName":"JOHN SMITH","amount":24000.50,"baseAmount":20000.50,"fees":[{"name":"VA Mandiri","amount":4000.25}],"expiredDate":"2026-07-28T14:00:00.000Z"}}',
        { headers: { "Content-Type": "application/json" } },
      ),
    });
    const result = await client({
      address: ADDRESS,
      customer: { subject: "subject-a", customerName: "JOHN SMITH" },
      toBeMinted: "20000.50",
      rail: "bank-va",
      channelId: "MANDIRI",
      returnUrl: "https://home.example/fund?return=idrx",
    });
    expect(result).toMatchObject({
      amount: "24000.50",
      baseAmount: "20000.50",
      fees: [{ name: "VA Mandiri", amount: "4000.25" }],
    });
  });

  test("fails closed without secrets, on 401, and on non-IDRX checkout URLs", async () => {
    const missing = createIdrxMintClient({ env: {} });
    await expect(
      missing({
        address: ADDRESS,
        customer: { subject: "subject-a", customerName: "JOHN SMITH" },
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "https://home.example/fund?return=idrx",
      }),
    ).rejects.toMatchObject({ code: "not-configured" });

    let hostedCalls = 0;
    const unauthorized = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET, IDRX_CUSTOMER_SUBJECT: "subject-a", IDRX_CUSTOMER_NAME: "JOHN SMITH" },
      fetchImplementation: async (_input, init) => {
        if (JSON.parse(String(init?.body)).paymentMethod !== "va") hostedCalls += 1;
        return new Response("no", { status: 401 });
      },
    });
    await expect(
      unauthorized({
        address: ADDRESS,
        customer: { subject: "subject-a", customerName: "JOHN SMITH" },
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "https://home.example/fund?return=idrx",
      }),
    ).rejects.toBeInstanceOf(IdrxMintError);
    expect(hostedCalls).toBe(0);

    const invalid = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET, IDRX_CUSTOMER_SUBJECT: "subject-a", IDRX_CUSTOMER_NAME: "JOHN SMITH" },
      fetchImplementation: async () =>
        Response.json({
          statusCode: 200,
          data: {
            merchantOrderId: "20260728130000",
            paymentUrl: "https://evil.example/checkout?token=leak",
          },
        }),
    });
    await expect(
      invalid({
        address: ADDRESS,
        customer: { subject: "subject-a", customerName: "JOHN SMITH" },
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "https://home.example/fund?return=idrx",
      }),
    ).rejects.toBeInstanceOf(IdrxMintError);
    expect(() => parseIdrxCheckoutUrl("https://evil.example/checkout?token=leak")).toThrow(
      IdrxMintError,
    );
  });

  test("does not open a second mint after a 5xx VA response", async () => {
    let calls = 0;
    const client = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET, IDRX_CUSTOMER_SUBJECT: "subject-a", IDRX_CUSTOMER_NAME: "JOHN SMITH" },
      fetchImplementation: async () => {
        calls += 1;
        return new Response("no", { status: 503 });
      },
    });
    await expect(
      client({
        address: ADDRESS,
        customer: { subject: "subject-a", customerName: "JOHN SMITH" },
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "https://home.example/fund?return=idrx",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(calls).toBe(1);
  });

  test("rejects amounts outside the issuer 2-decimal IDR window", () => {
    expect(isAllowedIdrxMintAmount("20000")).toBe(true);
    expect(isAllowedIdrxMintAmount("20000.00")).toBe(true);
    expect(isAllowedIdrxMintAmount("20000.5")).toBe(true);
    expect(isAllowedIdrxMintAmount("19999.99")).toBe(false);
    expect(isAllowedIdrxMintAmount("20000.001")).toBe(false);
    expect(isAllowedIdrxMintAmount("1000000000.01")).toBe(false);
    expect(isAllowedIdrxMintAmount(20000)).toBe(false);
    expect(isAllowedIdrxMintAmount("2e4")).toBe(false);
    expect(isAllowedIdrxMintAmount("020000")).toBe(false);
  });
});
