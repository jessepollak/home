import { describe, expect, test } from "bun:test";
import {
  FundingRequestError,
  parseHostedOnrampSession,
  requestHostedOnrampSession,
} from "./funding-client";
import { FUNDING_BASE_USDC_ADDRESS } from "./types";

function hosted(url = "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture") {
  return {
    url,
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
  test("accepts only the expected Coinbase hosted URL and exact Base USDC identity", () => {
    expect(parseHostedOnrampSession(hosted()).network.chainId).toBe(8453);
    expect(() =>
      parseHostedOnrampSession(hosted("https://evil.example/buy/select-asset?sessionToken=fixture")),
    ).toThrow(FundingRequestError);
    expect(() =>
      parseHostedOnrampSession({ ...hosted(), network: { name: "Base", chainId: 1 } }),
    ).toThrow(FundingRequestError);
  });

  test("uses the shared authenticated funding transport and preserves missing-config readiness", async () => {
    const calls: unknown[] = [];
    await expect(
      requestHostedOnrampSession({
        fetchAccountResource: async (...args) => {
          calls.push(args);
          throw Object.assign(new Error("unavailable"), { status: 424 });
        },
      }),
    ).rejects.toMatchObject({ code: "not-configured" });
    expect(calls).toEqual([
      [
        "/api/funding/onramp-session",
        {
          method: "POST",
          body: { assetId: "usdc" },
          signal: undefined,
        },
      ],
    ]);
  });
});
