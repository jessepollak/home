import { describe, expect, test } from "bun:test";
import {
  createCoinbaseOnrampClient,
  CoinbaseOnrampError,
  isOnrampSandbox,
} from "./coinbase-onramp";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const PAYMENT_LINK =
  "https://pay.coinbase.com/v2/api-onramp/apple-pay?sessionToken=fixture";
const HOSTED_URL = "https://pay.coinbase.com/buy?sessionToken=fixture";

function request() {
  return {
    address: ADDRESS,
    redirectUrl: "https://home.example/fund?return=coinbase",
    domain: "home.example",
    partnerUserRef: "subject-a",
    paymentMethod: "apple-pay" as const,
    paymentAmount: "20.00",
  };
}

function liveEnvironment() {
  return {
    CDP_API_KEY_ID: "key-id",
    [["CDP", "API", "KEY", "SECRET"].join("_")]: "secret",
    VERCEL_ENV: "production",
  };
}

describe("Coinbase Onramp client", () => {
  test("creates a sandbox headless order bound to canonical USDC on Base", async () => {
    const jwtOptions: unknown[] = [];
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const client = createCoinbaseOnrampClient({
      env: {
        CDP_API_KEY_ID: "key-id",
        CDP_API_KEY_SECRET: "secret",
        NODE_ENV: "development",
      },
      generateJwtImplementation: async (options) => {
        jwtOptions.push(options);
        return "signed-jwt";
      },
      fetchImplementation: async (input, init) => {
        requests.push({ input: String(input), init });
        return Response.json({ paymentLink: { url: PAYMENT_LINK } });
      },
    });

    const result = await client(request());

    expect(jwtOptions).toEqual([
      {
        apiKeyId: "key-id",
        apiKeySecret: "secret",
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: "/platform/v2/onramp/orders",
        expiresIn: 120,
      },
    ]);
    expect(requests[0]?.input).toBe(
      "https://api.cdp.coinbase.com/platform/v2/onramp/orders",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      purchaseCurrency: "USDC",
      paymentCurrency: "USD",
      paymentAmount: "20.00",
      paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
      destinationNetwork: "base",
      destinationAddress: ADDRESS,
      partnerUserRef: "sandbox-subject-a",
      domain: "home.example",
    });
    expect(result).toEqual({
      url: `${PAYMENT_LINK}&useApplePaySandbox=true`,
      presentation: "iframe",
      asset: {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
      network: { name: "Base", chainId: 8453 },
    });
  });

  test("fails closed in Preview when headless is unavailable, even with a live override", async () => {
    const requests: string[] = [];
    const client = createCoinbaseOnrampClient({
      env: {
        CDP_API_KEY_ID: "key-id",
        CDP_API_KEY_SECRET: "secret",
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        CDP_ONRAMP_SANDBOX: "0",
      },
      generateJwtImplementation: async () => "signed-jwt",
      fetchImplementation: async (input) => {
        requests.push(String(input));
        return new Response(null, { status: 503 });
      },
    });

    await expect(client(request())).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toEqual([
      "https://api.cdp.coinbase.com/platform/v2/onramp/orders",
    ]);
  });

  test("does not start hosted fallback after headless verification is cancelled", async () => {
    const requests: string[] = [];
    const aborter = new AbortController();
    const client = createCoinbaseOnrampClient({
      env: liveEnvironment(),
      generateJwtImplementation: async () => "signed-jwt",
      fetchImplementation: async (input) => {
        requests.push(String(input));
        aborter.abort();
        throw new DOMException("The request was cancelled.", "AbortError");
      },
    });

    await expect(
      client({ ...request(), signal: aborter.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(requests).toEqual([
      "https://api.cdp.coinbase.com/platform/v2/onramp/orders",
    ]);
  });

  test("uses hosted fallback only in live mode when the order API is unavailable", async () => {
    const requests: string[] = [];
    const client = createCoinbaseOnrampClient({
      env: {
        CDP_API_KEY_ID: "key-id",
        CDP_API_KEY_SECRET: "secret",
        VERCEL_ENV: "production",
      },
      generateJwtImplementation: async () => "signed-jwt",
      fetchImplementation: async (input) => {
        requests.push(String(input));
        if (String(input).endsWith("/onramp/orders")) {
          return new Response(null, { status: 503 });
        }
        return Response.json({ session: { onrampUrl: HOSTED_URL } });
      },
    });

    const result = await client(request());
    expect(requests).toEqual([
      "https://api.cdp.coinbase.com/platform/v2/onramp/orders",
      "https://api.cdp.coinbase.com/platform/v2/onramp/sessions",
    ]);
    expect(result.presentation).toBe("hosted");
    expect(result.url).toBe(HOSTED_URL);
  });

  test("preserves live hosted fallback after an order transport error", async () => {
    const requests: string[] = [];
    const client = createCoinbaseOnrampClient({
      env: liveEnvironment(),
      generateJwtImplementation: async () => "signed-jwt",
      fetchImplementation: async (input) => {
        requests.push(String(input));
        if (String(input).endsWith("/onramp/orders")) {
          throw new Error("connection reset");
        }
        return Response.json({ session: { onrampUrl: HOSTED_URL } });
      },
    });

    const result = await client(request());
    expect(requests).toEqual([
      "https://api.cdp.coinbase.com/platform/v2/onramp/orders",
      "https://api.cdp.coinbase.com/platform/v2/onramp/sessions",
    ]);
    expect(result).toMatchObject({ presentation: "hosted", url: HOSTED_URL });
  });

  test("fails closed for missing credentials and invalid Coinbase response URLs", async () => {
    const missing = createCoinbaseOnrampClient({ env: {} });
    await expect(missing(request())).rejects.toMatchObject({
      code: "not-configured",
    });

    const invalid = createCoinbaseOnrampClient({
      env: {
        CDP_API_KEY_ID: "key-id",
        CDP_API_KEY_SECRET: "secret",
      },
      generateJwtImplementation: async () => "signed-jwt",
      fetchImplementation: async () =>
        Response.json({
          paymentLink: {
            url: "https://evil.example/v2/api-onramp/apple-pay?sessionToken=fixture",
          },
        }),
    });
    await expect(invalid(request())).rejects.toBeInstanceOf(CoinbaseOnrampError);
  });
});

describe("isOnrampSandbox", () => {
  test("keeps Preview sandboxed and defaults every non-production deployment to sandbox", () => {
    expect(
      isOnrampSandbox({
        VERCEL_ENV: "preview",
        CDP_ONRAMP_SANDBOX: "0",
      }),
    ).toBe(true);
    expect(isOnrampSandbox({ NODE_ENV: "production" })).toBe(true);
    expect(isOnrampSandbox({ NODE_ENV: "development" })).toBe(true);
  });

  test("allows live mode only outside Preview through production identity or explicit override", () => {
    expect(isOnrampSandbox({ VERCEL_ENV: "production" })).toBe(false);
    expect(isOnrampSandbox({ CDP_ONRAMP_SANDBOX: "0" })).toBe(false);
    expect(
      isOnrampSandbox({
        VERCEL_ENV: "production",
        CDP_ONRAMP_SANDBOX: "1",
      }),
    ).toBe(true);
  });
});
