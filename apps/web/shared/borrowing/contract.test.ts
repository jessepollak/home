import { describe, expect, test } from "bun:test";
import { BORROW_MARKETS } from "./config";
import { parseBorrowOverview, parseSnapshot } from "./contract";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const market = BORROW_MARKETS[0];
function detail(ref = market) {
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: ref.marketId, morpho: ref.morpho, loanToken: ref.loanToken, collateralToken: ref.collateralToken, oracle: ref.oracle, irm: ref.irm, lltvWad: ref.lltvWad.toString(), rank: ref.rank },
    eligibility: { mode: ref.availability, newRisk: ref.availability === "enabled", reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "1", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1", fetchedAt: "2026-09-24T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "1", borrowAprWad: "1", totalSupplyAssetsRaw: "1", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "0", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "0", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", rawBorrowCapacityAssetsRaw: "0", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null },
  };
}
function overview() {
  const snapshot = detail();
  return {
    version: "2", chainId: 8453, owner: { address: OWNER, accountProvider: "cdp-embedded" },
    discovery: { status: "partial", sourceBlock: { provider: snapshot.source.provider, blockNumber: snapshot.source.blockNumber, blockHash: snapshot.source.blockHash, blockTimestamp: snapshot.source.blockTimestamp }, candidateCount: 1, verifiedCount: 1, reason: null, fetchedAt: snapshot.source.fetchedAt },
    opportunities: [{ market: snapshot.market, availability: { status: "available", mode: "enabled", reason: null, source: snapshot.source, snapshot } }],
    positions: [],
  };
}

describe("borrow contract versions", () => {
  test("validates each detail market and owner independently", () => {
    for (const ref of BORROW_MARKETS) expect(parseSnapshot(detail(ref), OWNER)?.market.id).toBe(ref.marketId);
    expect(parseSnapshot({ ...detail(), version: "2" }, OWNER)).toBeNull();
    expect(parseSnapshot({ ...detail(), walletAddress: "0x2222222222222222222222222222222222222222" }, OWNER)).toBeNull();
    expect(parseSnapshot({ ...detail(), market: { ...detail().market, lltvWad: "1" } }, OWNER)).toBeNull();
  });

  test("accepts v2 shared-block available snapshots and no-market null-source envelopes", () => {
    expect(parseBorrowOverview(overview(), OWNER)).not.toBeNull();
    const empty = { ...overview(), discovery: { ...overview().discovery, sourceBlock: null, candidateCount: 0, verifiedCount: 0 }, opportunities: [] };
    expect(parseBorrowOverview(empty, OWNER)).not.toBeNull();
    expect(parseBorrowOverview({ ...empty, version: "1" }, OWNER)).toBeNull();
    expect(parseBorrowOverview({ ...empty, discovery: { ...empty.discovery, sourceBlock: overview().discovery.sourceBlock } }, OWNER)).toBeNull();
  });

  test("rejects owner, identity, source and snapshot divergence", () => {
    const base = overview();
    const valid = (bad: unknown) => parseBorrowOverview(bad, OWNER);
    expect(valid({ ...base, opportunities: [{ ...base.opportunities[0], availability: { ...base.opportunities[0].availability, snapshot: { ...detail(), walletAddress: "0x2222222222222222222222222222222222222222" } } }] })).toBeNull();
    expect(valid({ ...base, opportunities: [{ ...base.opportunities[0], availability: { ...base.opportunities[0].availability, snapshot: detail(BORROW_MARKETS[1]) } }] })).toBeNull();
    expect(valid({ ...base, opportunities: [{ ...base.opportunities[0], availability: { ...base.opportunities[0].availability, source: { ...detail().source, blockHash: `0x${"cd".repeat(32)}` } } }] })).toBeNull();
    expect(valid({ ...base, discovery: { ...base.discovery, sourceBlock: { ...base.discovery.sourceBlock, blockNumber: "2" } } })).toBeNull();
    expect(valid({ ...base, discovery: { ...base.discovery, sourceBlock: null } })).toBeNull();
  });
});
