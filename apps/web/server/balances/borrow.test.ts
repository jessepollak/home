import { describe, expect, test } from "bun:test";
import { BORROW_MARKETS, type BorrowMarketRef } from "@/shared/borrowing/config";
import type { MorphoMarketSnapshot, MorphoMarketRpcReader } from "@/server/morpho-markets/rpc";
import { borrowPricingPairs, borrowReadComplete, createBorrowPositionsReader } from "./borrow";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PIN = { number: "42", hash: `0x${"ab".repeat(32)}` as `0x${string}` };
function snapshot(position: { collateralRaw: string; debtAssetsRaw: string }): MorphoMarketSnapshot {
  return { source: { blockNumber: "42" }, state: { borrowAprWad: "51000000000000000" }, position } as MorphoMarketSnapshot;
}
function mockReader(fail = -1) {
  const calls: Array<{ markets: readonly BorrowMarketRef[]; at: unknown }> = [];
  const readSnapshots: MorphoMarketRpcReader["readSnapshots"] = async (_owner, markets, _signal, at) => {
    calls.push({ markets: markets as BorrowMarketRef[], at });
    return markets.map((market, index) => index === fail
      ? { market, error: new Error("market unavailable") as never }
      : { market, snapshot: snapshot({ collateralRaw: "100000", debtAssetsRaw: "30010000" }) });
  };
  return { readSnapshots, calls };
}

describe("borrow positions read", () => {
  test("reads all markets with one pinned batch and isolates a failed market", async () => {
    const source = mockReader(2);
    const read = await createBorrowPositionsReader({ readSnapshots: source.readSnapshots })(OWNER, PIN);
    expect(source.calls).toHaveLength(1);
    expect(source.calls[0].at).toEqual(PIN);
    expect(source.calls[0].markets).toEqual(BORROW_MARKETS);
    expect(read.markets).toHaveLength(5);
    expect(read.markets[2]).toEqual({ marketId: BORROW_MARKETS[2].marketId.toLowerCase() as `0x${string}`, status: "unavailable" });
    expect(read.markets[0]).toEqual({
      marketId: BORROW_MARKETS[0].marketId.toLowerCase() as `0x${string}`, status: "ready", blockNumber: "42",
      collateralRaw: "100000", debtAssetsRaw: "30010000", borrowAprWad: "51000000000000000",
    });
    expect(borrowReadComplete(read)).toBeFalse();
  });

  test("marks every market unavailable on pin or transport failure", async () => {
    const read = await createBorrowPositionsReader({ readSnapshots: async () => { throw new Error("block reorg"); } })(OWNER, PIN);
    expect(read.markets).toHaveLength(5);
    expect(read.markets.every((market) => market.status === "unavailable")).toBe(true);
  });

  test("rejects persisted unknown debt but permits unknown empty positions", () => {
    const configured = { marketId: BORROW_MARKETS[0].marketId.toLowerCase() as `0x${string}`, status: "ready" as const, blockNumber: "42", collateralRaw: "0", debtAssetsRaw: "0", borrowAprWad: "0" };
    const removed = { ...configured, marketId: `0x${"cd".repeat(32)}` as `0x${string}` };
    const all = BORROW_MARKETS.map((market) => ({ ...configured, marketId: market.marketId.toLowerCase() as `0x${string}` }));
    expect(borrowReadComplete({ markets: [...all, { ...removed, debtAssetsRaw: "5" }] })).toBeFalse();
    expect(borrowReadComplete({ markets: [...all, { ...removed, collateralRaw: "5" }] })).toBeFalse();
    expect(borrowReadComplete({ markets: [...all, removed] })).toBeTrue();
  });

  test("aborts a slow pinned batch at the deadline", async () => {
    const read = await createBorrowPositionsReader({
      deadlineMs: 5,
      readSnapshots: async (_owner, _markets, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    })(OWNER, PIN);
    expect(read.markets.every((market) => market.status === "unavailable")).toBe(true);
  });

  test("empty positions produce no pricing, each nonempty position prices its configured collateral and USDC", async () => {
    expect(borrowReadComplete(null)).toBeFalse();
    expect(borrowReadComplete({ markets: [] })).toBeFalse();
    const source: MorphoMarketRpcReader["readSnapshots"] = async (_owner, markets) => markets.map((market, index) => ({
      market, snapshot: snapshot({ collateralRaw: index === 1 ? "100000" : "0", debtAssetsRaw: "0" }),
    }));
    const read = await createBorrowPositionsReader({ readSnapshots: source })(OWNER, PIN);
    expect(borrowReadComplete(read)).toBeTrue();
    const [pair] = borrowPricingPairs(read);
    expect(borrowPricingPairs(read)).toHaveLength(1);
    expect(pair.collateral).toMatchObject({
      key: `eip155:8453/erc20:${BORROW_MARKETS[1].collateralToken.address.toLowerCase()}`,
      decimals: 6, balance: { status: "ready", baseUnits: "100000" },
    });
    expect(pair.debt).toMatchObject({
      key: `eip155:8453/erc20:${BORROW_MARKETS[1].loanToken.address.toLowerCase()}`,
      balance: { status: "ready", baseUnits: "0" },
    });
  });
});
