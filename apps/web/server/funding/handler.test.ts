import { describe, expect, test } from "bun:test";
import { FUNDING_BASE_USDC_ADDRESS } from "@/shared/funding/types";
import { createFundingOnrampSessionHandler } from "./handler";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const HOSTED_URL =
  "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture";

function authorizedSession() {
  return Response.json({
    user: { subject: "subject-a" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider: "base-account",
  });
}

function request(
  body: unknown = {
    assetId: "usdc",
    paymentMethod: "apple-pay",
    paymentAmount: "20",
  },
  options: { provider?: string; signal?: AbortSignal } = {},
) {
  return new Request("http://localhost:3111/api/funding/onramp-session", {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture",
      "Content-Type": "application/json",
      "X-Home-Account-Provider": options.provider ?? "base-account",
      "X-Forwarded-For": "203.0.113.7, 10.0.0.1",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

describe("funding onramp session handler", () => {
  test("binds required payment inputs to the verified owner, Base address, and USDC", async () => {
    const calls: unknown[] = [];
    const handler = createFundingOnrampSessionHandler({
      authorize: async () => authorizedSession(),
      createOnrampSession: async (options) => {
        calls.push(options);
        return {
          url: HOSTED_URL,
          presentation: "hosted",
          asset: {
            id: "usdc",
            symbol: "USDC",
            decimals: 6,
            tokenAddress: FUNDING_BASE_USDC_ADDRESS,
          },
          network: { name: "Base", chainId: 8453 },
        };
      },
    });

    const response = await handler(
      request({
        assetId: "usdc",
        paymentMethod: "google-pay",
        paymentAmount: "50.5",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(calls).toEqual([
      {
        address: ADDRESS,
        redirectUrl: "http://localhost:3111/fund?return=coinbase",
        domain: "localhost",
        partnerUserRef: "subject-a",
        paymentMethod: "google-pay",
        paymentAmount: "50.50",
        clientIp: "203.0.113.7",
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(await response.json()).toMatchObject({
      url: HOSTED_URL,
      presentation: "hosted",
      asset: { id: "usdc", tokenAddress: FUNDING_BASE_USDC_ADDRESS },
      network: { name: "Base", chainId: 8453 },
    });
  });

  test("rejects omitted, invalid, and browser-injected fields before provider use", async () => {
    let providerCalls = 0;
    const handler = createFundingOnrampSessionHandler({
      authorize: async () => authorizedSession(),
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });
    const bodies = [
      { assetId: "usdc", paymentAmount: "20" },
      { assetId: "usdc", paymentMethod: "apple-pay" },
      {
        assetId: "usdc",
        paymentMethod: "card",
        paymentAmount: "20",
      },
      {
        assetId: "usdc",
        paymentMethod: "apple-pay",
        paymentAmount: "0",
      },
      {
        assetId: "usdc",
        paymentMethod: "apple-pay",
        paymentAmount: "20",
        address: "0x2222222222222222222222222222222222222222",
      },
    ];

    for (const body of bodies) {
      const response = await handler(request(body));
      expect(response.status).toBe(400);
    }
    expect(providerCalls).toBe(0);
  });

  test("rejects malformed and oversized authorization responses before provider use", async () => {
    let providerCalls = 0;
    const responses = [
      () => new Response("{", { status: 200 }),
      () =>
        Response.json({
          user: { subject: "subject-a" },
          smartAccount: "not-an-account",
          accountProvider: "base-account",
        }),
      () =>
        new Response(JSON.stringify({ padding: "x".repeat(4096) }), {
          status: 200,
        }),
    ];

    for (const authorize of responses) {
      const handler = createFundingOnrampSessionHandler({
        authorize: async () => authorize(),
        createOnrampSession: async () => {
          providerCalls += 1;
          throw new Error("must not run");
        },
      });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTH_UNAVAILABLE" },
      });
    }
    expect(providerCalls).toBe(0);
  });

  test("rejects missing smart accounts before provider use", async () => {
    let providerCalls = 0;
    const handler = createFundingOnrampSessionHandler({
      authorize: async () =>
        Response.json({
          user: { subject: "subject-a" },
          smartAccount: null,
          accountProvider: "cdp-embedded",
        }),
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const response = await handler(
      request(undefined, { provider: "cdp-embedded" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SMART_ACCOUNT_UNAVAILABLE" },
    });
    expect(providerCalls).toBe(0);
  });

  test("rejects wrong-chain and mismatched-provider sessions before provider use", async () => {
    let providerCalls = 0;
    const sessions = [
      {
        user: { subject: "subject-a" },
        smartAccount: { address: ADDRESS, chainId: 1 },
        accountProvider: "base-account",
      },
      {
        user: { subject: "subject-a" },
        smartAccount: { address: ADDRESS, chainId: 8453 },
        accountProvider: "cdp-embedded",
      },
    ];

    for (const session of sessions) {
      const handler = createFundingOnrampSessionHandler({
        authorize: async () => Response.json(session),
        createOnrampSession: async () => {
          providerCalls += 1;
          throw new Error("must not run");
        },
      });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTH_UNAVAILABLE" },
      });
    }
    expect(providerCalls).toBe(0);
  });

  test("fails closed when bounded authorization reading is cancelled or errors in transport", async () => {
    let providerCalls = 0;
    const aborter = new AbortController();
    const cancelledBody = new ReadableStream<Uint8Array>();
    const cancelledHandler = createFundingOnrampSessionHandler({
      authorize: async () => new Response(cancelledBody, { status: 200 }),
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });
    const cancelledResponse = cancelledHandler(
      request(undefined, { signal: aborter.signal }),
    );
    aborter.abort();

    expect((await cancelledResponse).status).toBe(503);

    const transportHandler = createFundingOnrampSessionHandler({
      authorize: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("authorization transport failed"));
            },
          }),
          { status: 200 },
        ),
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });
    const transportResponse = await transportHandler(request());
    expect(transportResponse.status).toBe(503);
    expect(await transportResponse.json()).toMatchObject({
      error: { code: "AUTH_UNAVAILABLE" },
    });

    const rejectedHandler = createFundingOnrampSessionHandler({
      authorize: async () => {
        throw new Error("authorization request failed");
      },
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });
    const rejectedResponse = await rejectedHandler(request());
    expect(rejectedResponse.status).toBe(503);
    expect(await rejectedResponse.json()).toMatchObject({
      error: { code: "AUTH_UNAVAILABLE" },
    });
    expect(providerCalls).toBe(0);
  });

  test("preserves unauthenticated privacy and never calls Coinbase", async () => {
    let providerCalls = 0;
    const handler = createFundingOnrampSessionHandler({
      authorize: async () =>
        Response.json(
          {
            error: {
              code: "UNAUTHENTICATED",
              message: "A valid access token is required.",
            },
          },
          { status: 401 },
        ),
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(providerCalls).toBe(0);
  });
});
