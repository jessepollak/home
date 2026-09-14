import { describe, expect, test } from "bun:test";
import { DEFAULT_BORROW_MARKET } from "./config";
import { parseBorrowOverview, parseSnapshot } from "./contract";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const market = DEFAULT_BORROW_MARKET;
function detail() {
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank },
    eligibility: { mode: "enabled", newRisk: true, reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "1", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1", fetchedAt: "2026-09-13T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "1", borrowAprWad: "1", totalSupplyAssetsRaw: "1", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "0", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "0", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", rawBorrowCapacityAssetsRaw: "0", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null },
  };
}
describe("borrow contract versions", () => {
  test("accepts the current detail version and rejects drifted owner, market, or version", () => {
    expect(parseSnapshot(detail(), OWNER)).not.toBeNull();
    expect(parseSnapshot({ ...detail(), version: "2" }, OWNER)).toBeNull();
    expect(parseSnapshot({ ...detail(), walletAddress: "0x2222222222222222222222222222222222222222" }, OWNER)).toBeNull();
    expect(parseSnapshot({ ...detail(), market: { ...detail().market, lltvWad: "1" } }, OWNER)).toBeNull();
  });
  test("accepts the current overview version and rejects old envelopes", () => {
    const overview = { version: "1", chainId: 8453, owner: { address: OWNER, accountProvider: "cdp-embedded" }, discovery: { status: "complete", candidateCount: 0, verifiedCount: 0, reason: null, fetchedAt: "2026-09-13T12:00:00.000Z" }, opportunities: [], positions: [] };
    expect(parseBorrowOverview(overview, OWNER)).not.toBeNull();
    expect(parseBorrowOverview({ ...overview, version: "0" }, OWNER)).toBeNull();
  });
});
