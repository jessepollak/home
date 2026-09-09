import { describe, expect, test } from "bun:test";
import { IDRX_BASE_ADDRESS } from "./idrx";
import { createIdrxMintHandler } from "./idrx-handler";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function authorizedSession() {
  return Response.json({
    user: { subject: "subject-a" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider: "base-account",
  });
}

function request(body: unknown = {
  assetId: "idrx",
  country: "ID",
  toBeMinted: "20000",
}) {
  return new Request("http://localhost:3111/api/funding/idrx-mint", {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture-token",
      "Content-Type": "application/json",
      "X-Home-Account-Provider": "base-account",
    },
    body: JSON.stringify(body),
  });
}

describe("IDRX mint handler", () => {
  test("binds the session smart account and a same-origin return URL", async () => {
    const calls: Array<{
      address: string;
      toBeMinted: string;
      channelId: string;
      returnUrl: string;
    }> = [];
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      createMint: async (options) => {
        calls.push({
          address: options.address,
          toBeMinted: options.toBeMinted,
          channelId: options.channelId,
          returnUrl: options.returnUrl,
        });
        return {
          presentation: "virtual-account",
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
        };
      },
    });

    const response = await handler(request({
      assetId: "idrx",
      country: "ID",
      toBeMinted: "20000",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(calls).toEqual([
      {
        address: ADDRESS,
        toBeMinted: "20000",
        channelId: "MANDIRI",
        returnUrl: "http://localhost:3111/fund?return=idrx",
      },
    ]);
    expect(await response.json()).toMatchObject({
      presentation: "virtual-account",
      virtualAccountNo: "8680770000001234",
      asset: { decimals: 2, tokenAddress: IDRX_BASE_ADDRESS },
    });
  });

  test("rejects client-authored destination, extra keys, and non-Indonesia rails", async () => {
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      createMint: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const injected = await handler(
      request({
        assetId: "idrx",
        country: "ID",
        toBeMinted: "20000",
        destinationWalletAddress: "0x2222222222222222222222222222222222222222",
      }),
    );
    expect(injected.status).toBe(400);
    expect((await injected.json()).error.code).toBe("INVALID_IDRX_MINT");

    const otherCountry = await handler(
      request({ assetId: "idrx", country: "US", toBeMinted: "20000" }),
    );
    expect(otherCountry.status).toBe(400);
    expect((await otherCountry.json()).error.code).toBe("IDRX_COUNTRY_UNSUPPORTED");

    const usdc = await handler(request({ assetId: "usdc", country: "ID", toBeMinted: "20000" }));
    expect(usdc.status).toBe(400);
    expect(providerCalls).toBe(0);
  });

  test("preserves unauthenticated privacy and never calls IDRX", async () => {
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () =>
        Response.json(
          { error: { code: "UNAUTHENTICATED", message: "A valid access token is required." } },
          { status: 401 },
        ),
      createMint: async () => {
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
