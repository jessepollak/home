import { describe, expect, test } from "bun:test";
import { BORROW_HEALTH_FLOOR_WAD, BORROW_MARKETS, type BorrowMarketRef } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import type { BorrowActionIntent } from "@/shared/borrowing/types";
import { approveCall, borrowCall, repayCall, repaySharesCall, supplyCollateralCall, withdrawCollateralCall } from "./abi";
import { availableBorrowAssets, borrowCapacityAssets, minimumCollateralForHealthFactor, policyMaximumDebtAssets } from "./math";
import { BorrowPreparationError, prepareBorrowAction } from "./prepare";
import type { BorrowRpcReader } from "./rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
const prices = [
  "843242900000000000000000000000000000000",
  "1504740000000000000000000000000000000",
  "3059024445000000000000000000",
  "941080000000000000000000000000000",
  "238684290000000000000000000000000000",
];
const debt = BigInt("1000000");
function snapshot(market: BorrowMarketRef, options: { zeroDebt?: boolean; health?: string; collateral?: bigint } = {}): BorrowMarketSnapshot {
  const collateral = options.collateral ?? BigInt("10000") * BigInt(10) ** BigInt(market.collateralToken.decimals);
  const price = prices[market.rank - 1];
  const shares = options.zeroDebt ? BigInt(0) : debt;
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank },
    eligibility: { mode: market.availability, newRisk: market.availability === "enabled", reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "51714405", blockHash: BLOCK_HASH, blockTimestamp: "1790218157", fetchedAt: "2026-09-24T02:49:17.000Z" },
    state: { oraclePriceRaw: price, borrowRatePerSecondWad: "0", borrowAprWad: "0", totalSupplyAssetsRaw: "10000000000", totalBorrowAssetsRaw: "1000000000", totalBorrowSharesRaw: "1000000000", liquidityAssetsRaw: "9000000000", lastUpdateTimestamp: "1790218150" },
    wallet: { collateralBalanceRaw: (collateral * BigInt(2)).toString(), loanBalanceRaw: "10000000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: collateral.toString(), borrowSharesRaw: shares.toString(), debtAssetsRaw: shares.toString(), rawBorrowCapacityAssetsRaw: "1", borrowCapacityAssetsRaw: "1", rawWithdrawableCollateralRaw: collateral.toString(), withdrawableCollateralRaw: collateral.toString(), healthFactorWad: options.health ?? (options.zeroDebt ? null : "1500000000000000000"), liquidationPriceRaw: options.zeroDebt ? null : "1" },
  };
}
function intent(market: BorrowMarketRef, operation: BorrowActionIntent["operation"]): BorrowActionIntent {
  return operation === "repay-all" || operation === "close-position"
    ? { marketId: market.marketId, operation, maximumRepayBaseUnits: "1250000" }
    : operation === "supply-and-borrow"
      ? { marketId: market.marketId, operation, amountBaseUnits: "100000", collateralAmountBaseUnits: "100" }
      : { marketId: market.marketId, operation, amountBaseUnits: "100" };
}
function expectedCalls(market: BorrowMarketRef, operation: BorrowActionIntent["operation"], collateral: bigint) {
  const approval = (asset: BorrowMarketRef["loanToken"], amount: bigint) => approveCall(asset, market.morpho, amount);
  switch (operation) {
    case "supply-collateral": return [approval(market.collateralToken, BigInt(100)), supplyCollateralCall(market, BigInt(100), OWNER)];
    case "borrow": return [borrowCall(market, BigInt(100), OWNER)];
    case "supply-and-borrow": return [approval(market.collateralToken, BigInt(100)), supplyCollateralCall(market, BigInt(100), OWNER), borrowCall(market, BigInt(100000), OWNER)];
    case "repay": return [approval(market.loanToken, BigInt(100)), repayCall(market, BigInt(100), OWNER)];
    case "repay-all": return [approval(market.loanToken, BigInt(1250000)), repaySharesCall(market, debt, OWNER)];
    case "withdraw-collateral": return [withdrawCollateralCall(market, BigInt(100), OWNER)];
    case "close-position": return [approval(market.loanToken, BigInt(1250000)), repaySharesCall(market, debt, OWNER), withdrawCollateralCall(market, collateral, OWNER)];
  }
}
function rpc() {
  const simulations: Array<{ calls: Parameters<BorrowRpcReader["simulateBatch"]>[0]; owner: string; number: string; hash: string }> = [];
  const reader: BorrowRpcReader = {
    readSnapshots: async () => [], readSnapshot: async (_owner, market) => snapshot(market),
    simulateBatch: async (calls, owner, number, hash) => { simulations.push({ calls, owner, number, hash }); },
  };
  return { reader, simulations };
}
async function prepare(market: BorrowMarketRef, operation: BorrowActionIntent["operation"], state = snapshot(market)) {
  const { reader, simulations } = rpc();
  const result = await prepareBorrowAction({ request: intent(market, operation), market, snapshot: state, rpc: reader, now: () => new Date("2026-09-24T02:49:17.000Z") });
  return { result, simulations };
}
const operations = ["supply-collateral", "borrow", "supply-and-borrow", "repay", "repay-all", "withdraw-collateral", "close-position"] as const;

describe("Borrow action preparation across verified markets", () => {
  test.each([...BORROW_MARKETS])("prepares all seven operations against $collateralToken.symbol with exact calldata and one pinned simulation", async (market) => {
    for (const operation of operations) {
      const state = snapshot(market);
      const { result, simulations } = await prepare(market, operation, state);
      const calls = expectedCalls(market, operation, BigInt(state.position.collateralRaw));
      expect(result.draft.calls).toEqual(calls);
      expect(simulations).toEqual([{ calls, owner: OWNER, number: "51714405", hash: BLOCK_HASH }]);
      expect(result.draft.calls.every((call) => !call.data.startsWith("0x095ea7b3") || BigInt(`0x${call.data.slice(-64)}`) > BigInt(0))).toBe(true);
      expect(result.draft.metadata).toMatchObject({ product: "borrow", marketId: market.marketId, source: { blockNumber: "51714405", blockHash: BLOCK_HASH } });
      expect(result.fullySimulated).toBe(true);
    }
  });

  test.each([...BORROW_MARKETS])("preserves $collateralToken.symbol management access in reducing-only mode", async (enabled) => {
    const market = { ...enabled, availability: "reducing-only" as const };
    const state = snapshot(market);
    for (const operation of ["borrow", "supply-and-borrow", "withdraw-collateral"] as const) {
      await expect(prepare(market, operation, state)).rejects.toMatchObject({ code: "unsupported-market" });
    }
    for (const operation of ["repay", "repay-all", "supply-collateral", "close-position"] as const) {
      expect((await prepare(market, operation, state)).result.fullySimulated).toBe(true);
    }
    expect((await prepare(market, "withdraw-collateral", snapshot(market, { zeroDebt: true }))).result.fullySimulated).toBe(true);
  });

  test.each([...BORROW_MARKETS])("rejects $collateralToken.symbol borrow above the 1.25 health floor", async (market) => {
    const minimum = minimumCollateralForHealthFactor(debt + BigInt("1000000"), BigInt(prices[market.rank - 1]), market.lltvWad, BORROW_HEALTH_FLOOR_WAD);
    const next = snapshot(market, { collateral: minimum });
    const maximumDebt = policyMaximumDebtAssets(borrowCapacityAssets(BigInt(next.position.collateralRaw), BigInt(next.state.oraclePriceRaw), market.lltvWad), BORROW_HEALTH_FLOOR_WAD);
    const capacity = availableBorrowAssets({
      positionBorrowShares: BigInt(next.position.borrowSharesRaw), totalBorrowAssets: BigInt(next.state.totalBorrowAssetsRaw),
      totalBorrowShares: BigInt(next.state.totalBorrowSharesRaw), maxDebtAssets: maximumDebt,
      liquidityAssets: BigInt(next.state.liquidityAssetsRaw),
    });
    expect(capacity).toBeGreaterThan(BigInt(0));
    const accepted = await prepareBorrowAction({ request: { marketId: market.marketId, operation: "borrow", amountBaseUnits: capacity.toString() }, market, snapshot: next, rpc: rpc().reader });
    expect(accepted.draft.metadata?.product).toBe("borrow");
    if (accepted.draft.metadata?.product !== "borrow") throw new Error("Expected borrow metadata.");
    expect(BigInt(accepted.draft.metadata.projectedHealthFactorWad!)).toBeGreaterThanOrEqual(BORROW_HEALTH_FLOOR_WAD);
    await expect(prepareBorrowAction({ request: { marketId: market.marketId, operation: "borrow", amountBaseUnits: (capacity + BigInt(1)).toString() }, market, snapshot: next, rpc: rpc().reader })).rejects.toBeInstanceOf(BorrowPreparationError);
  });

  test("requires a bounded repay-all cap and rejects extra client authority", async () => {
    const market = BORROW_MARKETS[0];
    for (const cap of ["999999", "10000000001"]) {
      await expect(prepareBorrowAction({ request: { marketId: market.marketId, operation: "repay-all", maximumRepayBaseUnits: cap }, market, snapshot: snapshot(market), rpc: rpc().reader })).rejects.toBeInstanceOf(BorrowPreparationError);
    }
    const { parseBorrowActionIntent } = await import("@/shared/borrowing/types");
    expect(parseBorrowActionIntent({ marketId: market.marketId, operation: "borrow", amountBaseUnits: "1", owner: OWNER })).toBeNull();
  });
});
