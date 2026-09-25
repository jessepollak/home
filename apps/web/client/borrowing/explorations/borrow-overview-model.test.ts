import { describe, expect, test } from "bun:test";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { parseBorrowOverview, type BorrowOverviewResponse, type BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { borrowableAssets, loanActions, openLoans, summarizeBorrowOverview } from "./borrow-overview-model";

const market = VERIFIED_MORPHO_MARKETS;
function fixture(changes: Array<[number, Partial<BorrowMarketSnapshot>]>) {
  const base = borrowOverviewBody({ openMarketId: null });
  const opportunities = base.opportunities.map((entry, index) => {
    const patch = changes.find(([position]) => position === index)?.[1];
    if (entry.availability.status !== "available" || !patch) return entry;
    return { ...entry, availability: { ...entry.availability, snapshot: { ...entry.availability.snapshot, ...patch } } };
  });
  return { ...base, opportunities };
}
const debt = (amount: string, hf = "1900000000000000000") => ({ debtAssetsRaw: amount, collateralRaw: "100000000", borrowSharesRaw: amount, borrowCapacityAssetsRaw: "100000000", withdrawableCollateralRaw: "20000000", healthFactorWad: hf });
const snapshot = (overview: BorrowOverviewResponse, index: number) => {
  const entry = overview.opportunities[index]!;
  if (entry.availability.status !== "available") throw new Error("Expected market snapshot");
  return entry.availability.snapshot;
};

describe("borrow overview derivations", () => {
  test("weights APR by positive base-unit debt, excluding zero-debt rates", () => {
    const base = borrowOverviewBody({ openMarketId: null });
    const overview = fixture([
      [0, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 0).position, ...debt("1000000000") }, state: { ...snapshot(base, 0).state, borrowAprWad: "40000000000000000" } }],
      [2, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 2).position, ...debt("3000000000") }, state: { ...snapshot(base, 2).state, borrowAprWad: "80000000000000000" } }],
      [3, { state: { ...snapshot(base, 3).state, borrowAprWad: "990000000000000000" } }],
    ]);
    expect(summarizeBorrowOverview(overview)).toMatchObject({ totalDebtRaw: "4000000000", aprWad: "70000000000000000", openLoanCount: 2 });
  });
  test("no debt omits APR and partial discovery or unavailable opportunity stays partial", () => {
    const empty = borrowOverviewBody({ openMarketId: null });
    expect(summarizeBorrowOverview(empty)).toMatchObject({ totalDebtRaw: "0", aprWad: null, completeness: "complete" });
    expect(summarizeBorrowOverview({ ...empty, discovery: { ...empty.discovery, status: "partial" } }).completeness).toBe("partial");
    expect(summarizeBorrowOverview(borrowOverviewBody({ unavailableMarketId: market[1]!.marketId })).completeness).toBe("partial");
  });
  test("reports unavailable rather than zero when no markets can be verified", () => {
    const base = borrowOverviewBody({ openMarketId: null });
    const overview: BorrowOverviewResponse = {
      ...base,
      discovery: { ...base.discovery, status: "partial", verifiedCount: 0, sourceBlock: null, reason: "Markets unavailable" },
      opportunities: base.opportunities.map((entry) => ({
        market: entry.market,
        availability: { status: "unavailable", mode: entry.availability.mode, reason: "Market unavailable", source: null },
      })),
    };
    expect(parseBorrowOverview(overview, overview.owner.address)).not.toBeNull();
    expect(summarizeBorrowOverview(overview).completeness).toBe("unavailable");
  });
  test("refuses to add differently denominated loans", () => {
    const base = borrowOverviewBody({ openMarketId: null });
    const mixed = fixture([[0, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 0).position, ...debt("1000000000") } }], [2, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 2).position, ...debt("3000000000") }, market: { ...snapshot(base, 2).market, loanToken: { ...snapshot(base, 2).market.loanToken, decimals: 8 } } }]]);
    expect(() => summarizeBorrowOverview(mixed)).toThrow();
  });
  test("prioritizes urgent debt, then health, then rank, preserving collateral-only and isolated rows", () => {
    const overview = fixture([[0, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 0).position, ...debt("100", "1900000000000000000") } }], [2, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 2).position, ...debt("100", "1200000000000000000") } }], [3, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 3).position, ...debt("100", "1200000000000000000") } }], [1, { position: { ...snapshot(borrowOverviewBody({ openMarketId: null }), 1).position, collateralRaw: "1200000000" } }]]);
    expect(openLoans(overview).map((row) => row.market.id)).toEqual([market[2]!.marketId, market[3]!.marketId, market[0]!.marketId, market[1]!.marketId]);
    expect(openLoans(overview)[3]!.kind).toBe("available");
    const distinct = { ...overview, opportunities: overview.opportunities.map((entry) => ({ ...entry, market: { ...entry.market, collateralToken: { ...entry.market.collateralToken, symbol: "cbBTC" } } })) };
    expect(openLoans(distinct).filter((row) => row.kind === "available")).toHaveLength(4);
  });
  test("keeps an unavailable known position reachable", () => {
    const overview = borrowOverviewBody({ openMarketId: null, unavailableMarketId: market[0]!.marketId });
    const position = borrowOverviewBody({ openMarketId: market[0]!.marketId }).positions[0]!;
    expect(openLoans({ ...overview, positions: [position] }).map((row) => row.kind)).toEqual(["unavailable"]);
  });
  test("puts eligible wallet collateral ahead of unheld assets, excluding reducing-only unpositioned markets", () => {
    const base = borrowOverviewBody({ openMarketId: null });
    const overview = fixture([[0, { wallet: { ...snapshot(base, 0).wallet, collateralBalanceRaw: "0" } }], [1, { wallet: { ...snapshot(base, 1).wallet, collateralBalanceRaw: "0" } }], [3, { wallet: { ...snapshot(base, 3).wallet, collateralBalanceRaw: "0" } }], [4, { wallet: { ...snapshot(base, 4).wallet, collateralBalanceRaw: "2500000000000000000000" } }], [2, { eligibility: { mode: "reducing-only", newRisk: false, reason: "Paused" } }]]);
    expect(borrowableAssets(overview).map((asset) => [asset.market.id, asset.kind])).toEqual([[market[4]!.marketId, "held"], [market[0]!.marketId, "not-held"], [market[1]!.marketId, "not-held"], [market[3]!.marketId, "not-held"]]);
    expect(borrowableAssets(overview)[0]).toHaveProperty("openingAvailableRaw");
  });
  test("sorts held collateral without capacity after borrowable held assets and before unheld assets", () => {
    const base = borrowOverviewBody({ openMarketId: null });
    const overview = fixture([
      [0, { state: { ...snapshot(base, 0).state, liquidityAssetsRaw: "0" } }],
      [2, { wallet: { ...snapshot(base, 2).wallet, collateralBalanceRaw: "1" } }],
      [3, { wallet: { ...snapshot(base, 3).wallet, collateralBalanceRaw: "0" } }],
      [4, { wallet: { ...snapshot(base, 4).wallet, collateralBalanceRaw: "0" } }],
    ]);
    const unavailable = borrowOverviewBody({ openMarketId: null, unavailableMarketId: market[4]!.marketId }).opportunities[4]!;
    const assets = borrowableAssets({ ...overview, opportunities: [...overview.opportunities.slice(0, 4), unavailable] });
    expect(assets.map((asset) => [asset.market.id, asset.kind])).toEqual([
      [market[1]!.marketId, "held"],
      [market[0]!.marketId, "held-no-capacity"],
      [market[2]!.marketId, "held-no-capacity"],
      [market[3]!.marketId, "not-held"],
      [market[4]!.marketId, "unavailable"],
    ]);
    expect(assets[1]).toMatchObject({ snapshot: { wallet: { collateralBalanceRaw: snapshot(base, 0).wallet.collateralBalanceRaw } } });
    expect(assets[2]).toMatchObject({ snapshot: { wallet: { collateralBalanceRaw: "1" } } });
    expect(loanActions(snapshot(overview, 0)).borrowOpen).toBe(false);
    expect(loanActions(snapshot(overview, 2)).borrowOpen).toBe(false);
  });
  test("returns held collateral to borrowable assets despite a stale position", () => {
    const base = borrowOverviewBody({ openMarketId: market[1]!.marketId });
    const original = snapshot(base, 1);
    const overview: BorrowOverviewResponse = {
      ...fixture([[1, {
        position: { ...original.position, debtAssetsRaw: "0", borrowSharesRaw: "0", collateralRaw: "0" },
        wallet: { ...original.wallet, collateralBalanceRaw: "1200000000" },
      }]]),
      positions: base.positions,
    };
    expect(openLoans(overview).some((row) => row.market.id === market[1]!.marketId)).toBe(false);
    expect(borrowableAssets(overview).find((asset) => asset.market.id === market[1]!.marketId)).toMatchObject({ kind: "held" });
  });
  test("mirrors healthy, urgent, reducing-only, collateral-only and empty-wallet action gates", () => {
    const base = borrowOverviewBody({ openMarketId: null });
    const original = snapshot(base, 0);
    const healthy = { ...original, position: { ...original.position, ...debt("100000000") } };
    expect(loanActions(healthy)).toMatchObject({ repay: true, borrowMore: true, addCollateral: true, withdraw: true, borrowOpen: false, reason: null });
    const urgent = { ...healthy, position: { ...healthy.position, healthFactorWad: "1200000000000000000" } };
    expect(loanActions(urgent)).toMatchObject({ repay: true, borrowMore: false, withdraw: false });
    expect(loanActions(urgent).reason).toContain("Below Home");
    const paused = { ...healthy, eligibility: { mode: "reducing-only" as const, newRisk: false, reason: "Paused" } };
    expect(loanActions(paused)).toMatchObject({ borrowMore: false, withdraw: false, reason: "Paused" });
    expect(loanActions(original)).toMatchObject({ repay: true, borrowMore: false, borrowOpen: true });
    const noWallet = { ...healthy, wallet: { ...healthy.wallet, loanBalanceRaw: "0" } };
    expect(loanActions(noWallet)).toMatchObject({ repay: false, reason: "Add USDC to your wallet to repay." });
  });
});
