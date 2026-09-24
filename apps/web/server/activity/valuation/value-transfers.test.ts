import { describe, expect, test } from "bun:test";
import { activityAssets } from "@/shared/activity/types";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import {
  historicalCloseKey,
  type HistoricalCloseReader,
  type HistoricalCloseRequest,
} from "./codex-closes";
import {
  dailyFxKey,
  type DailyFxReader,
  type DailyFxRequest,
} from "./coinbase-daily-fx";
import {
  createActivityTransferValuer,
  type UnvaluedActivityTransfer,
} from "./value-transfers";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TEST_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const TEST_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const AT = "2026-09-07T11:05:00.000Z";
const usdc = activityAssets.find((asset) => asset.id === "usdc")!;
const eurc = verifiedLocalCashAssets.EUR;

function transfer(overrides: Partial<UnvaluedActivityTransfer> = {}): UnvaluedActivityTransfer {
  const tokenAddress = overrides.tokenAddress ?? TEST_A;
  return {
    id: `8453:${tokenAddress}:log`,
    logId: "log",
    chainId: 8453,
    assetId: null,
    tokenAddress,
    tokenSymbol: "TEST",
    tokenDecimals: 18,
    walletAddress: WALLET,
    fromAddress: OTHER,
    toAddress: WALLET,
    direction: "incoming",
    amountBaseUnits: "56780000000000000000",
    blockNumber: "20",
    blockHash: `0x${"b".repeat(64)}`,
    transactionHash: `0x${"a".repeat(64)}`,
    logIndex: "1",
    blockTimestamp: AT,
    ...overrides,
  };
}

function close(priceAtoms: string, scale: number) {
  return {
    status: "found" as const,
    close: {
      provider: "Codex" as const,
      closedAt: "2026-09-07T11:00:00.000Z",
      resolutionMinutes: 15 as const,
      priceUsd: { atoms: priceAtoms, scale },
    },
  };
}

function fakeCloses(
  byContract: Record<string, ReturnType<typeof close> | { status: "none" } | { status: "unavailable" }>,
  seen: HistoricalCloseRequest[][] = [],
): HistoricalCloseReader {
  return async (requests) => {
    seen.push([...requests]);
    return new Map(requests.map((request) => [
      historicalCloseKey(request),
      byContract[request.contract] ?? { status: "unavailable" as const },
    ]));
  };
}

function fakeFx(
  rates: Record<string, string>,
  seen: DailyFxRequest[][] = [],
): DailyFxReader {
  return async (requests) => {
    seen.push([...requests]);
    return new Map(requests.map((request) => {
      const key = dailyFxKey(request);
      const rate = rates[`${request.base}:${request.quote}`];
      return [key, rate ? { rate: { atoms: rate, scale: 4 }, provisional: false } : null];
    }));
  };
}

describe("activity transfer valuer", () => {
  test("values USDC at its USD peg without any market-data request", async () => {
    const closeCalls: HistoricalCloseRequest[][] = [];
    const fxCalls: DailyFxRequest[][] = [];
    const valuer = createActivityTransferValuer({
      readCloses: fakeCloses({}, closeCalls),
      readFx: fakeFx({}, fxCalls),
    });
    const [valuation] = await valuer([transfer({
      assetId: "usdc",
      tokenAddress: usdc.tokenAddress.toLowerCase() as `0x${string}`,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      amountBaseUnits: "12340000",
    })], "USD");
    expect(valuation).toEqual({
      status: "priced",
      currency: "USD",
      amount: computeActivityValuationAmount({
        amountBaseUnits: "12340000",
        tokenDecimals: 6,
        unitPrice: null,
        fxRate: null,
      }),
      method: "peg",
      peg: "USD",
      close: null,
      fx: null,
    });
    expect(closeCalls).toEqual([]);
    expect(fxCalls).toEqual([]);
  });

  test("converts EURC at that day's EUR→USD rate and keeps EURC at par for EUR presentation", async () => {
    const eurcTransfer = transfer({
      assetId: "eurc",
      tokenAddress: eurc.contractAddress,
      tokenSymbol: "EURC",
      tokenDecimals: 6,
      amountBaseUnits: "10000000",
    });
    const valuer = createActivityTransferValuer({
      readCloses: fakeCloses({}),
      readFx: fakeFx({ "EUR:USD": "11617" }),
    });
    const [usd] = await valuer([eurcTransfer], "USD");
    expect(usd).toMatchObject({
      status: "priced",
      method: "peg",
      peg: "EUR",
      amount: { atoms: "11617000000000000000", scale: 18 },
      fx: { provider: "Coinbase", base: "EUR", quote: "USD", date: "2026-09-07" },
    });
    const [eur] = await valuer([eurcTransfer], "EUR");
    expect(eur).toMatchObject({ status: "priced", currency: "EUR", fx: null });
  });

  test("prices volatile tokens by exact contract, including same-symbol contracts and tokens no longer held", async () => {
    const closeCalls: HistoricalCloseRequest[][] = [];
    const valuer = createActivityTransferValuer({
      readCloses: fakeCloses({
        [TEST_A]: close("2173291", 7),
        [TEST_B]: close("5", 0),
      }, closeCalls),
      readFx: fakeFx({}),
    });
    const [first, second] = await valuer([
      transfer(),
      transfer({ tokenAddress: TEST_B, id: `8453:${TEST_B}:log` }),
    ], "USD");
    expect(closeCalls).toHaveLength(1);
    expect(first).toMatchObject({
      status: "priced",
      method: "historical-close",
      amount: computeActivityValuationAmount({
        amountBaseUnits: "56780000000000000000",
        tokenDecimals: 18,
        unitPrice: { atoms: "2173291", scale: 7 },
        fxRate: null,
      }),
    });
    expect(second).toMatchObject({
      status: "priced",
      amount: { atoms: "283900000000000000000", scale: 18 },
    });
  });

  test("converts historical USD closes into the presentation currency at the transfer day's rate", async () => {
    const valuer = createActivityTransferValuer({
      readCloses: fakeCloses({ [TEST_A]: close("2", 0) }),
      readFx: fakeFx({ "USD:EUR": "8600" }),
    });
    const [valuation] = await valuer([transfer({ amountBaseUnits: "1000000000000000000" })], "EUR");
    expect(valuation).toMatchObject({
      status: "priced",
      currency: "EUR",
      amount: { atoms: "1720000000000000000", scale: 18 },
      fx: { base: "USD", quote: "EUR", date: "2026-09-07" },
    });
  });

  test("keeps dust and very large quantities exact", async () => {
    const valuer = createActivityTransferValuer({
      readCloses: fakeCloses({ [TEST_A]: close("1", 6) }),
      readFx: fakeFx({}),
    });
    const [dust, large] = await valuer([
      transfer({ amountBaseUnits: "1" }),
      transfer({ amountBaseUnits: "123456789012345678901234567890", id: "8453:x:large" }),
    ], "USD");
    expect(dust).toMatchObject({ status: "priced" });
    if (dust?.status !== "priced") throw new Error("expected priced dust");
    expect(BigInt(dust.amount.atoms) > BigInt(0)).toBe(true);
    expect(large).toMatchObject({
      status: "priced",
      amount: { atoms: "123456789012345678901235", scale: 18 },
    });
  });

  test("returns honest unpriced states and never falls back to a peg, zero, or spot", async () => {
    const valuer = createActivityTransferValuer({
      readCloses: fakeCloses({ [TEST_A]: { status: "none" }, [TEST_B]: { status: "unavailable" } }),
      readFx: fakeFx({}),
    });
    const valuations = await valuer([
      transfer(),
      transfer({ tokenAddress: TEST_B }),
      transfer({ tokenSymbol: null, tokenDecimals: null }),
      transfer({
        assetId: "eurc",
        tokenAddress: eurc.contractAddress,
        tokenSymbol: "EURC",
        tokenDecimals: 6,
      }),
    ], "USD");
    expect(valuations).toEqual([
      { status: "unpriced", currency: "USD", reason: "no-recent-close" },
      { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
      { status: "unpriced", currency: "USD", reason: "unknown-token" },
      { status: "unpriced", currency: "USD", reason: "fx-unavailable" },
    ]);
  });

  test("keeps transfers visible when the quote providers throw", async () => {
    const valuer = createActivityTransferValuer({
      readCloses: async () => {
        throw new Error("codex down");
      },
      readFx: async () => {
        throw new Error("coinbase down");
      },
    });
    expect(await valuer([transfer()], "EUR")).toEqual([
      { status: "unpriced", currency: "EUR", reason: "quote-unavailable" },
    ]);
  });
});
