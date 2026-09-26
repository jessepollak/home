import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ACTIVITY_CONTRACT_VERSION,
  ActivityResponseError,
  compareActivityTransferKeys,
  parseActivityPage,
  type ActivityResponse,
} from "./contract";
import { computeActivityValuationAmount } from "./valuation";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TO = "2026-09-07T12:00:00.000Z";
const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: WALLET, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function validPage(): ActivityResponse {
  return {
    version: ACTIVITY_CONTRACT_VERSION,
    walletAddress: WALLET,
    chainId: 8453,
    window: { from: "2026-08-07T12:00:00.000Z", to: TO },
    currency: "USD",
    transfers: [
      {
        id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:event-2",
        logId: "event-2",
        chainId: 8453,
        assetId: "usdc",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        tokenImageUrl: null,
        walletAddress: WALLET,
        fromAddress: OTHER,
        toAddress: WALLET,
        direction: "incoming",
        amountBaseUnits: "1000001",
        blockNumber: "20",
        blockHash: `0x${"b".repeat(64)}`,
        transactionHash: `0x${"d".repeat(64)}`,
        logIndex: "2",
        blockTimestamp: "2026-09-07T11:00:00.000Z",
        valuation: {
          status: "priced",
          currency: "USD",
          amount: computeActivityValuationAmount({
            amountBaseUnits: "1000001",
            tokenDecimals: 6,
            unitPrice: null,
            fxRate: null,
          }),
          method: "peg",
          peg: "USD",
          close: null,
          fx: null,
        },
      },
      {
        id: "8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf:event-1",
        logId: "event-1",
        chainId: 8453,
        assetId: "cbbtc",
        tokenAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        tokenSymbol: "cbBTC",
        tokenDecimals: 8,
        tokenImageUrl: null,
        walletAddress: WALLET,
        fromAddress: WALLET,
        toAddress: OTHER,
        direction: "outgoing",
        amountBaseUnits: "1",
        blockNumber: "19",
        blockHash: `0x${"a".repeat(64)}`,
        transactionHash: `0x${"c".repeat(64)}`,
        logIndex: "1",
        blockTimestamp: "2026-09-06T11:00:00.000Z",
        valuation: { status: "unpriced", currency: "USD", reason: "no-recent-close" },
      },
    ],
    nextCursor: "cursor",
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: "2026-09-07T11:59:00.000Z",
      executionTimeMs: 2,
      fetchedAt: TO,
    },
  };
}

describe("activity response parser", () => {
  test("accepts lossless scoped transfers in strict keyset order", () => {
    const page = parseActivityPage(validPage(), session, TO);
    expect(page.transfers.map((transfer) => transfer.amountBaseUnits)).toEqual([
      "1000001",
      "1",
    ]);
    expect(page.transfers.map((transfer) => transfer.direction)).toEqual([
      "incoming",
      "outgoing",
    ]);
  });


  test("orders same-block transfers by block-scoped log index before transaction hash", () => {
    const base = validPage().transfers[0]!;
    const higherLogLowHash = {
      ...base,
      id: `8453:${base.tokenAddress.toLowerCase()}:higher-log`,
      logId: "higher-log",
      logIndex: "10",
      transactionHash: `0x${"a".repeat(64)}` as const,
    };
    const lowerLogHighHash = {
      ...base,
      id: `8453:${base.tokenAddress.toLowerCase()}:lower-log`,
      logId: "lower-log",
      logIndex: "9",
      transactionHash: `0x${"f".repeat(64)}` as const,
    };

    expect(compareActivityTransferKeys(higherLogLowHash, lowerLogHighHash)).toBe(1);
    expect(parseActivityPage(
      {
        ...validPage(),
        transfers: [higherLogLowHash, lowerLogHighHash],
        nextCursor: null,
      },
      session,
      TO,
    ).transfers).toHaveLength(2);
  });

  test("accepts the staged CDP Address History source discriminator", () => {
    const parsed = parseActivityPage(
      {
        ...validPage(),
        source: {
          ...validPage().source,
          provider: "cdp-address-history",
          cached: false,
          stale: false,
        },
      },
      session,
      TO,
    );
    expect(parsed.source.provider).toBe("cdp-address-history");
    expect(() => parseActivityPage(
      {
        ...validPage(),
        source: { ...validPage().source, provider: "unknown" },
      },
      session,
      TO,
    )).toThrow(ActivityResponseError);
  });

  test("accepts ZORA metadata with canonical contract identity and no registry id", () => {
    const base = validPage();
    const zoraAddress = "0x1111111111166b7fe7bd91427724b487980afc69";
    const zora = {
      ...base.transfers[0],
      id: `8453:${zoraAddress}:zora-log`,
      logId: "zora-log",
      assetId: null,
      tokenAddress: zoraAddress,
      tokenSymbol: "ZORA",
      tokenDecimals: 18,
      amountBaseUnits: "1000000000000000001",
    };
    const parsed = parseActivityPage(
      { ...base, transfers: [zora], nextCursor: null },
      session,
      TO,
    );
    expect(parsed.transfers[0]).toMatchObject({
      assetId: null,
      tokenAddress: zoraAddress,
      tokenSymbol: "ZORA",
      tokenDecimals: 18,
      amountBaseUnits: "1000000000000000001",
    });
  });

  test("accepts an unknown contract with honest null metadata", () => {
    const base = validPage();
    const unknownAddress = "0x4444444444444444444444444444444444444444";
    const unknown = {
      ...base.transfers[0],
      id: `8453:${unknownAddress}:unknown-log`,
      logId: "unknown-log",
      assetId: null,
      tokenAddress: unknownAddress,
      tokenSymbol: null,
      tokenDecimals: null,
    };
    const parsed = parseActivityPage(
      { ...base, transfers: [unknown], nextCursor: null },
      session,
      TO,
    );
    expect(parsed.transfers[0]).toMatchObject({
      assetId: null,
      tokenAddress: unknownAddress,
      tokenSymbol: null,
      tokenDecimals: null,
      amountBaseUnits: "1000001",
    });
  });

  test("rejects an unversioned or unknown contract version, another wallet, forged token metadata, invalid direction, duplicate rows, and unstable windows", () => {
    const base = validPage();
    const { version: _version, ...unversioned } = base;
    const cases: unknown[] = [
      unversioned,
      { ...base, version: 2 },
      { ...base, version: "1" },
      { ...base, walletAddress: OTHER },
      {
        ...base,
        transfers: [{ ...base.transfers[0], assetId: null }],
      },
      {
        ...base,
        transfers: [{ ...base.transfers[0], tokenSymbol: "FAKE" }],
      },
      {
        ...base,
        transfers: [{ ...base.transfers[0], tokenDecimals: 18 }],
      },
      {
        ...base,
        transfers: [{ ...base.transfers[0], direction: "outgoing" }],
      },
      {
        ...base,
        transfers: [base.transfers[0], base.transfers[0]],
      },
      {
        ...base,
        window: { ...base.window, to: "2026-09-07T11:59:59.000Z" },
      },
    ];

    for (const value of cases) {
      expect(() => parseActivityPage(value, session, TO)).toThrow(
        ActivityResponseError,
      );
    }
  });

  test("rejects forged dynamic metadata, unsafe symbols, collisions, and invalid decimals", () => {
    const base = validPage();
    const address = "0x4444444444444444444444444444444444444444";
    const dynamic = {
      ...base.transfers[0],
      id: `8453:${address}:dynamic-log`,
      logId: "dynamic-log",
      assetId: null,
      tokenAddress: address,
      tokenSymbol: "TOKEN",
      tokenDecimals: 18,
    };
    const cases = [
      { ...dynamic, assetId: "usdc" },
      { ...dynamic, tokenSymbol: null },
      { ...dynamic, tokenDecimals: null },
      { ...dynamic, tokenSymbol: " BAD " },
      { ...dynamic, tokenSymbol: "BAD\u0001" },
      { ...dynamic, tokenSymbol: "BAD\u0085" },
      { ...dynamic, tokenSymbol: "BAD\u2028" },
      { ...dynamic, tokenSymbol: "BAD\u2029" },
      { ...dynamic, tokenSymbol: "BAD\u202e" },
      { ...dynamic, tokenSymbol: "BAD\u200b" },
      { ...dynamic, tokenSymbol: "usdc" },
      { ...dynamic, tokenSymbol: "USDC-" },
      { ...dynamic, tokenSymbol: "U5DC" },
      { ...dynamic, tokenSymbol: "E.T.H" },
      { ...dynamic, tokenSymbol: "USDС" },
      { ...dynamic, tokenSymbol: "claim.xyz" },
      { ...dynamic, tokenSymbol: "www.claim" },
      { ...dynamic, tokenSymbol: "https://x.io" },
      { ...dynamic, tokenDecimals: -1 },
      { ...dynamic, tokenDecimals: 256 },
      { ...dynamic, tokenDecimals: 1.5 },
    ];
    for (const transfer of cases) {
      expect(() => parseActivityPage(
        { ...base, transfers: [transfer], nextCursor: null },
        session,
        TO,
      )).toThrow(ActivityResponseError);
    }
  });

  test("accepts only canonical safe exact-contract images, with a broader curated host policy", () => {
    const base = validPage();
    const address = "0x4444444444444444444444444444444444444444";
    const dynamic = {
      ...base.transfers[0],
      id: `8453:${address}:image`,
      logId: "image",
      tokenAddress: address,
      assetId: null,
      tokenSymbol: "ZORA",
      tokenDecimals: 18,
    };
    const parse = (transfer: unknown) => parseActivityPage(
      { ...base, transfers: [transfer], nextCursor: null }, session, TO,
    ).transfers[0]!;
    const providerImage = "https://token-media.defined.fi/zora.svg";
    expect(parse({ ...dynamic, tokenImageUrl: providerImage }).tokenImageUrl).toBe(providerImage);
    expect(parse({ ...dynamic, tokenImageUrl: "https://media.thegrid.id/icon.png" }).tokenImageUrl)
      .toBe("https://media.thegrid.id/icon.png");
    expect(parse({ ...dynamic, tokenImageUrl: undefined }).tokenImageUrl).toBeNull();
    expect(parse({ ...dynamic, tokenImageUrl: null }).tokenImageUrl).toBeNull();
    expect(parse({ ...base.transfers[0], tokenImageUrl: "https://icons.example/usdc.svg" }).tokenImageUrl)
      .toBe("https://icons.example/usdc.svg");
    for (const image of [
      "https://not-token-media.defined.fi/icon.png",
      "http://token-media.defined.fi/icon.png",
      "javascript:alert(1)",
      "https://user:password@token-media.defined.fi/icon.png",
      "https://token-media.defined.fi/icon.png#fragment",
      `https://token-media.defined.fi/${"x".repeat(2048)}`,
      " https://token-media.defined.fi/icon.png ",
      42,
    ]) {
      expect(() => parse({ ...dynamic, tokenImageUrl: image })).toThrow(ActivityResponseError);
    }
    expect(() => parse({ ...dynamic, tokenSymbol: null, tokenDecimals: null, tokenImageUrl: providerImage }))
      .toThrow(ActivityResponseError);
    expect(() => parse({ ...base.transfers[0], tokenImageUrl: "http://icons.example/usdc.svg" }))
      .toThrow(ActivityResponseError);
  });

  test("rejects malformed amounts and rows outside the bounded window", () => {
    const base = validPage();
    expect(() =>
      parseActivityPage(
        {
          ...base,
          transfers: [{ ...base.transfers[0], amountBaseUnits: "1.5" }],
        },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
    expect(() =>
      parseActivityPage(
        {
          ...base,
          transfers: [{ ...base.transfers[0], amountBaseUnits: 1 }],
        },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
    expect(() =>
      parseActivityPage(
        {
          ...base,
          transfers: [{ ...base.transfers[0], blockTimestamp: TO }],
        },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
  });
});

describe("activity valuation parser", () => {
  const TEST_TOKEN = "0x5555555555555555555555555555555555555555" as const;

  function volatilePage(valuation: unknown, currency = "USD"): unknown {
    const base = validPage();
    return {
      ...base,
      currency,
      transfers: [{
        ...base.transfers[0],
        id: `8453:${TEST_TOKEN}:event-2`,
        assetId: null,
        tokenAddress: TEST_TOKEN,
        tokenSymbol: "TEST",
        tokenDecimals: 18,
        amountBaseUnits: "56780000000000000000",
        valuation,
      }],
    };
  }

  const close = {
    provider: "Codex",
    closedAt: "2026-09-07T10:30:00.000Z",
    resolutionMinutes: 15,
    priceUsd: { atoms: "2173291", scale: 7 },
  } as const;

  function historicalValuation(overrides: Record<string, unknown> = {}) {
    return {
      status: "priced",
      currency: "USD",
      amount: computeActivityValuationAmount({
        amountBaseUnits: "56780000000000000000",
        tokenDecimals: 18,
        unitPrice: close.priceUsd,
        fxRate: null,
      }),
      method: "historical-close",
      peg: null,
      close,
      fx: null,
      ...overrides,
    };
  }

  test("keeps a consistent historical close valuation with its provenance", () => {
    const page = parseActivityPage(volatilePage(historicalValuation()), session, TO);
    const valuation = page.transfers[0]!.valuation;
    expect(valuation).toMatchObject({ status: "priced", method: "historical-close", close });
    if (valuation.status !== "priced") throw new Error("expected priced");
    expect(valuation.amount).toEqual(computeActivityValuationAmount({
      amountBaseUnits: "56780000000000000000",
      tokenDecimals: 18,
      unitPrice: { atoms: "2173291", scale: 7 },
      fxRate: null,
    }));
  });

  test("downgrades inconsistent or unsupported valuations to unpriced without dropping the transfer", () => {
    const invalid = [
      historicalValuation({ amount: { atoms: "1234", scale: 2 } }),
      historicalValuation({ close: { ...close, closedAt: "2026-09-06T10:59:59.000Z" } }),
      historicalValuation({ close: { ...close, closedAt: "2026-09-07T11:15:00.000Z" } }),
      historicalValuation({ method: "spot" }),
      historicalValuation({ method: "peg", peg: "USD", close: null }),
      historicalValuation({ currency: "EUR" }),
      { status: "unpriced", currency: "USD", reason: "zero" },
      null,
    ];
    for (const valuation of invalid) {
      const page = parseActivityPage(volatilePage(valuation), session, TO);
      expect(page.transfers).toHaveLength(1);
      expect(page.transfers[0]!.valuation).toEqual({
        status: "unpriced",
        currency: "USD",
        reason: "quote-unavailable",
      });
    }
  });

  test("requires the page currency to match the requested presentation currency", () => {
    expect(() => parseActivityPage(volatilePage(historicalValuation()), session, TO, "EUR"))
      .toThrow(ActivityResponseError);
    const eurRate = { atoms: "86078", scale: 5 };
    const eurValuation = historicalValuation({
      currency: "EUR",
      amount: computeActivityValuationAmount({
        amountBaseUnits: "56780000000000000000",
        tokenDecimals: 18,
        unitPrice: close.priceUsd,
        fxRate: eurRate,
      }),
      fx: {
        provider: "Coinbase",
        base: "USD",
        quote: "EUR",
        date: "2026-09-07",
        rate: eurRate,
        provisional: false,
      },
    });
    const page = parseActivityPage(volatilePage(eurValuation, "EUR"), session, TO, "EUR");
    expect(page.currency).toBe("EUR");
    expect(page.transfers[0]!.valuation).toMatchObject({ status: "priced", currency: "EUR" });

    const wrongDay = parseActivityPage(
      volatilePage({ ...eurValuation, fx: { ...(eurValuation.fx as unknown as object), date: "2026-09-06" } }, "EUR"),
      session,
      TO,
      "EUR",
    );
    expect(wrongDay.transfers[0]!.valuation.status).toBe("unpriced");
  });

  test("applies the stablecoin peg only to verified peg contracts", () => {
    const pegValuation = {
      status: "priced",
      currency: "USD",
      amount: computeActivityValuationAmount({
        amountBaseUnits: "56780000000000000000",
        tokenDecimals: 18,
        unitPrice: null,
        fxRate: null,
      }),
      method: "peg",
      peg: "USD",
      close: null,
      fx: null,
    };
    const page = parseActivityPage(volatilePage(pegValuation), session, TO);
    expect(page.transfers[0]!.valuation.status).toBe("unpriced");
  });
});
