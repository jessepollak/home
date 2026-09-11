import { describe, expect, test } from "bun:test";
import { FUNDING_BASE_USDC_ADDRESS } from "@/shared/funding/types";
import { createFundingOnrampSessionHandler } from "./handler";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const HOSTED_URL = "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture";

function authorizedSession() {
  return Response.json({
    user: { subject: "subject-a" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider: "base-account",
  });
}

function request(body: unknown = { assetId: "usdc" }) {
  return new Request("http://localhost:3111/api/funding/onramp-session", {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture-token",
      "Content-Type": "application/json",
      "X-Home-Account-Provider": "base-account",
    },
    body: JSON.stringify(body),
  });
}

describe("funding onramp session handler", () => {
  test("binds Coinbase to the server-verified Base address and a fixed same-origin return", async () => {
    const calls: Array<{ address: string; redirectUrl: string }> = [];
    const handler = createFundingOnrampSessionHandler({
      authorize: async () => authorizedSession(),
      createOnrampSession: async (options) => {
        calls.push({ address: options.address, redirectUrl: options.redirectUrl });
        return {
          url: HOSTED_URL,
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

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(calls).toEqual([
      {
        address: ADDRESS,
        redirectUrl: "http://localhost:3111/fund?return=coinbase",
      },
    ]);
    expect(await response.json()).toEqual({
      url: HOSTED_URL,
      asset: {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        tokenAddress: FUNDING_BASE_USDC_ADDRESS,
      },
      network: { name: "Base", chainId: 8453 },
    });
  });

  test("rejects browser-supplied destination fields before provider use", async () => {
    let authorizations = 0;
    let providerCalls = 0;
    const handler = createFundingOnrampSessionHandler({
      authorize: async () => {
        authorizations += 1;
        return authorizedSession();
      },
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const injected = await handler(
      request({ assetId: "usdc", address: "0x2222222222222222222222222222222222222222" }),
    );
    expect(injected.status).toBe(400);
    expect(authorizations).toBe(1);
    expect(providerCalls).toBe(0);
  });

  test("preserves unauthenticated privacy and never calls Coinbase", async () => {
    let providerCalls = 0;
    const handler = createFundingOnrampSessionHandler({
      authorize: async () =>
        Response.json(
          { error: { code: "UNAUTHENTICATED", message: "A valid access token is required." } },
          { status: 401 },
        ),
      createOnrampSession: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(providerCalls).toBe(0);
  });
});
