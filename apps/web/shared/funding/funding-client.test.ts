import { describe, expect, test } from "bun:test";
import {
  FundingRequestError,
  parseHostedOnrampSession,
  parseIdrxMintResult,
  requestHostedOnrampSession,
  requestIdrxMint,
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

  test("accepts only exact IDRX/Base identity and a pending balance-and-activity boundary", () => {
    const result = parseIdrxMintResult({
      presentation: "virtual-account",
      rail: "bank-va",
      asset: {
        id: "idrx",
        symbol: "IDRX",
        decimals: 2,
        tokenAddress: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
      },
      network: { name: "Base", chainId: 8453 },
      merchantOrderId: "order-1",
      reference: "ref-1",
      virtualAccountNo: "8680770000001234",
      virtualAccountName: "HOME TEST",
      amount: "24000",
      baseAmount: "20000",
      fees: [{ name: "VA", amount: "4000" }],
      expiredDate: "2026-09-11T12:00:00.000Z",
      channelId: "MANDIRI",
      verification: { status: "pending", boundary: "balance-and-activity" },
    });
    expect(result.verification).toEqual({
      status: "pending",
      boundary: "balance-and-activity",
    });
    expect(() => parseIdrxMintResult({ ...result, asset: { ...result.asset, decimals: 18 } }))
      .toThrow(FundingRequestError);
    expect(() => parseIdrxMintResult({
      ...result,
      verification: { status: "confirmed", boundary: "provider" },
    })).toThrow(FundingRequestError);
  });

  test("sends only the Indonesia rail intent and explicit KYC consent", async () => {
    const calls: unknown[] = [];
    await requestIdrxMint({
      fetchAccountResource: async (...args) => {
        calls.push(args);
        return {
          presentation: "hosted",
          rail: "qris",
          asset: {
            id: "idrx",
            symbol: "IDRX",
            decimals: 2,
            tokenAddress: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
          },
          network: { name: "Base", chainId: 8453 },
          merchantOrderId: "order-2",
          url: "https://checkout.idrx.co/?token=fixture",
          verification: { status: "pending", boundary: "balance-and-activity" },
        };
      },
      toBeMinted: "20000",
      rail: "qris",
      consent: true,
    });
    expect(calls).toEqual([["/api/funding/idrx-mint", {
      method: "POST",
      body: {
        assetId: "idrx",
        country: "ID",
        toBeMinted: "20000",
        rail: "qris",
        consent: true,
      },
      signal: undefined,
    }]]);
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
