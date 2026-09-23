import { describe, expect, test } from "bun:test";
import type { MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";
import { DEFAULT_BORROW_MARKET, type BorrowMarketRef } from "@/shared/borrowing/config";
import { borrowPricingPairs, borrowReadComplete, createBorrowPositionsReader } from "./borrow";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PIN = { number: "42", hash: `0x${"ab".repeat(32)}` as `0x${string}` };
const SECOND_MARKET: BorrowMarketRef = {
  ...DEFAULT_BORROW_MARKET,
  marketId: `0x${"cd".repeat(32)}`,
  rank: 2,
};

function morphoSnapshot(position: { collateralRaw: string; debtAssetsRaw: string }): MorphoMarketSnapshot {
  return {
    source: { blockNumber: "42" },
    state: { borrowAprWad: "51000000000000000" },
    position,
  } as unknown as MorphoMarketSnapshot;
}

describe("borrow positions read", () => {
  test("reads every market and marks a failed market unavailable, never zero", async () => {
    const readSnapshot = async (_owner: string, market: BorrowMarketRef) => {
      if (market.marketId === SECOND_MARKET.marketId) throw new Error("rpc down");
      return morphoSnapshot({ collateralRaw: "100000", debtAssetsRaw: "30010000" });
    };
    const read = await createBorrowPositionsReader({
      readSnapshot,
      markets: [DEFAULT_BORROW_MARKET, SECOND_MARKET],
    })(OWNER, PIN);

    expect(read.markets).toEqual([
      {
        marketId: DEFAULT_BORROW_MARKET.marketId.toLowerCase() as `0x${string}`,
        status: "ready",
        blockNumber: "42",
        collateralRaw: "100000",
        debtAssetsRaw: "30010000",
        borrowAprWad: "51000000000000000",
      },
      { marketId: SECOND_MARKET.marketId, status: "unavailable" },
    ]);
    expect(borrowReadComplete(read)).toBeFalse();
  });

  test("reads every market at the registry block and marks a failed pinned read unavailable", async () => {
    const pins: unknown[] = [];
    const read = await createBorrowPositionsReader({
      markets: [DEFAULT_BORROW_MARKET, SECOND_MARKET],
      readSnapshot: async (_owner, market, _signal, at) => {
        pins.push(at);
        if (market.marketId === SECOND_MARKET.marketId) throw new Error("The pinned Base block is not canonical.");
        return morphoSnapshot({ collateralRaw: "1", debtAssetsRaw: "0" });
      },
    })(OWNER, PIN);
    expect(pins).toEqual([PIN, PIN]);
    expect(read.markets.map((market) => market.status)).toEqual(["ready", "unavailable"]);
    expect(borrowReadComplete(read)).toBeFalse();
  });

  test("a stored position in a market that is no longer configured is partial, not dropped", () => {
    const configured = {
      marketId: DEFAULT_BORROW_MARKET.marketId.toLowerCase() as `0x${string}`,
      status: "ready" as const,
      blockNumber: "42",
      collateralRaw: "0",
      debtAssetsRaw: "0",
      borrowAprWad: "0",
    };
    const removed = { ...configured, marketId: SECOND_MARKET.marketId as `0x${string}` };
    expect(borrowReadComplete({ markets: [configured, { ...removed, debtAssetsRaw: "5" }] })).toBeFalse();
    expect(borrowReadComplete({ markets: [configured, { ...removed, collateralRaw: "5" }] })).toBeFalse();
    expect(borrowReadComplete({ markets: [configured, removed] })).toBeTrue();
  });

  test("aborts a slow market read at the deadline", async () => {
    const read = await createBorrowPositionsReader({
      deadlineMs: 5,
      readSnapshot: (_owner, _market, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    })(OWNER, PIN);
    expect(read.markets.map((market) => market.status)).toEqual(["unavailable"]);
  });

  test("a missing or legacy read is incomplete; an empty position prices nothing", async () => {
    expect(borrowReadComplete(null)).toBeFalse();
    expect(borrowReadComplete({ markets: [] })).toBeFalse();
    const empty = await createBorrowPositionsReader({
      readSnapshot: async () => morphoSnapshot({ collateralRaw: "0", debtAssetsRaw: "0" }),
    })(OWNER, PIN);
    expect(borrowReadComplete(empty)).toBeTrue();
    expect(borrowPricingPairs(empty)).toEqual([]);
  });

  test("prices collateral as the market's collateral asset and debt as its loan asset", async () => {
    const read = await createBorrowPositionsReader({
      readSnapshot: async () => morphoSnapshot({ collateralRaw: "100000", debtAssetsRaw: "0" }),
    })(OWNER, PIN);
    const [pair] = borrowPricingPairs(read);
    expect(pair?.collateral).toMatchObject({
      key: `eip155:8453/erc20:${DEFAULT_BORROW_MARKET.collateralToken.address.toLowerCase()}`,
      source: "borrow",
      decimals: DEFAULT_BORROW_MARKET.collateralToken.decimals,
      balance: { status: "ready", baseUnits: "100000" },
    });
    expect(pair?.debt).toMatchObject({
      key: `eip155:8453/erc20:${DEFAULT_BORROW_MARKET.loanToken.address.toLowerCase()}`,
      balance: { status: "ready", baseUnits: "0" },
    });
  });
});
