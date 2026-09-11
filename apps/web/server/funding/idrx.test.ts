import { describe, expect, test } from "bun:test";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import {
  IDRX_API_BASE_URL,
  IDRX_BASE_ADDRESS,
  IDRX_DECIMALS,
  IDRX_MINT_PATH,
  IdrxMintError,
  assertIdrxBaseToken,
  createIdrxMintClient,
  isAllowedIdrxMintAmount,
  parseIdrxCheckoutUrl,
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
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET },
      now: () => 1_700_000_000_000,
      fetchImplementation: async (input, init) => {
        requests.push({ input: String(input), init });
        return Response.json(vaData());
      },
    });

    const result = await client({
      address: ADDRESS,
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

  test("creates QRIS only through the explicit hosted rail", async () => {
    const bodies: unknown[] = [];
    const client = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET },
      now: () => 1_700_000_000_000,
      fetchImplementation: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json(hostedData());
      },
    });

    const result = await client({
      address: ADDRESS,
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

  test("fails closed without secrets, on 401, and on non-IDRX checkout URLs", async () => {
    const missing = createIdrxMintClient({ env: {} });
    await expect(
      missing({
        address: ADDRESS,
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "https://home.example/fund?return=idrx",
      }),
    ).rejects.toMatchObject({ code: "not-configured" });

    let hostedCalls = 0;
    const unauthorized = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET },
      fetchImplementation: async (_input, init) => {
        if (JSON.parse(String(init?.body)).paymentMethod !== "va") hostedCalls += 1;
        return new Response("no", { status: 401 });
      },
    });
    await expect(
      unauthorized({
        address: ADDRESS,
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "https://home.example/fund?return=idrx",
      }),
    ).rejects.toBeInstanceOf(IdrxMintError);
    expect(hostedCalls).toBe(0);

    const invalid = createIdrxMintClient({
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET },
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
      env: { IDRX_CLIENT_ID: "public-key", IDRX_CLIENT_SECRET: SECRET },
      fetchImplementation: async () => {
        calls += 1;
        return new Response("no", { status: 503 });
      },
    });
    await expect(
      client({
        address: ADDRESS,
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
