import { describe, expect, test } from "bun:test";
import {
  FundingRequestError,
  parseHostedOnrampSession,
  requestHostedOnrampSession,
} from "./funding-client";
import { FUNDING_BASE_USDC_ADDRESS } from "./types";

function onramp(
  url = "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture",
  presentation: "iframe" | "hosted" = "hosted",
) {
  return {
    url,
    presentation,
    asset: {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      tokenAddress: FUNDING_BASE_USDC_ADDRESS,
    },
    network: { name: "Base", chainId: 8453 },
  };
}

describe("funding client boundaries", () => {
  test("accepts presentation-specific Coinbase URLs and exact Base USDC identity", () => {
    expect(parseHostedOnrampSession(onramp()).presentation).toBe("hosted");
    expect(
      parseHostedOnrampSession(
        onramp(
          "https://pay.coinbase.com/v2/api-onramp/apple-pay?sessionToken=fixture",
          "iframe",
        ),
      ).presentation,
    ).toBe("iframe");
    expect(() =>
      parseHostedOnrampSession(
        onramp(
          "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture",
          "iframe",
        ),
      ),
    ).toThrow(FundingRequestError);
    expect(() =>
      parseHostedOnrampSession({
        ...onramp(),
        network: { name: "Base", chainId: 1 },
      }),
    ).toThrow(FundingRequestError);
  });

  test("requires the exact Coinbase origin and exactly one nonblank session token", () => {
    const rejected = [
      "https://evil.example/buy?sessionToken=fixture",
      "https://pay.coinbase.com.evil.example/buy?sessionToken=fixture",
      "https://pay.coinbase.com:444/buy?sessionToken=fixture",
      "https://pay.coinbase.com/buy",
      "https://pay.coinbase.com/buy?sessionToken=",
      "https://pay.coinbase.com/buy?sessionToken=%20%20",
      "https://pay.coinbase.com/buy?sessionToken=one&sessionToken=two",
    ];
    for (const url of rejected) {
      expect(() => parseHostedOnrampSession(onramp(url))).toThrow(
        FundingRequestError,
      );
    }
  });

  test("sends required amount and method through the authenticated transport", async () => {
    const calls: unknown[] = [];
    await expect(
      requestHostedOnrampSession({
        fetchAccountResource: async (...args) => {
          calls.push(args);
          throw Object.assign(new Error("unavailable"), { status: 424 });
        },
        paymentMethod: "google-pay",
        paymentAmount: "50",
      }),
    ).rejects.toMatchObject({ code: "not-configured" });
    expect(calls).toEqual([
      [
        "/api/funding/onramp-session",
        {
          method: "POST",
          body: {
            assetId: "usdc",
            paymentMethod: "google-pay",
            paymentAmount: "50",
          },
          signal: undefined,
        },
      ],
    ]);
  });
});
