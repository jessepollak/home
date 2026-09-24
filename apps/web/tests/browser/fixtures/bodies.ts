import { portfolioVaults, PORTFOLIO_USDC_ADDRESS } from "../../../config/portfolio-assets";
import { VERIFIED_MORPHO_MARKETS } from "../../../shared/morpho-markets/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "../../../shared/borrowing/contract";
import {
  borrowCapacityAssets,
  healthFactorWad,
  liquidationPriceRaw,
  minimumCollateralForHealthFactor,
  policyMaximumDebtAssets,
} from "../../../shared/morpho-markets/math";
import { BORROW_HEALTH_FLOOR_WAD } from "../../../shared/borrowing/config";

export const sessionBody = {
  user: { subject: "playwright-smoke-subject" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

export const actionsBody = { actions: [] };
export const fundingProvidersBody = { providers: [] };
export const fundingOfframpOrdersBody = { version: 3, recoveryEligible: false, orders: [] };
export const basenameProfileBody = { profile: null };

const BORROW_BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const BORROW_FETCHED_AT = "2026-09-13T12:00:00.000Z";
const BORROW_ORACLE_PRICES = [
  "843242900000000000000000000000000000000",
  "1504740000000000000000000000000000000",
  "3059024445000000000000000000",
  "941080000000000000000000000000000",
  "238684290000000000000000000000000000",
] as const;
const BORROW_FIXTURE_DEBT = BigInt("100000000");

function borrowFixturePosition(oraclePriceRaw: string, lltvWad: bigint, targetHealthWad: bigint) {
  const price = BigInt(oraclePriceRaw);
  const collateral = minimumCollateralForHealthFactor(BORROW_FIXTURE_DEBT, price, lltvWad, targetHealthWad);
  const rawCapacity = borrowCapacityAssets(collateral, price, lltvWad);
  const policyCapacity = policyMaximumDebtAssets(rawCapacity, BORROW_HEALTH_FLOOR_WAD);
  const floorCollateral = minimumCollateralForHealthFactor(BORROW_FIXTURE_DEBT, price, lltvWad, BORROW_HEALTH_FLOOR_WAD);
  const rawFloorCollateral = minimumCollateralForHealthFactor(BORROW_FIXTURE_DEBT, price, lltvWad, BigInt("1000000000000000000"));
  return {
    collateralRaw: collateral.toString(),
    borrowSharesRaw: BORROW_FIXTURE_DEBT.toString(),
    debtAssetsRaw: BORROW_FIXTURE_DEBT.toString(),
    rawBorrowCapacityAssetsRaw: (rawCapacity > BORROW_FIXTURE_DEBT ? rawCapacity - BORROW_FIXTURE_DEBT : BigInt(0)).toString(),
    borrowCapacityAssetsRaw: (policyCapacity > BORROW_FIXTURE_DEBT ? policyCapacity - BORROW_FIXTURE_DEBT : BigInt(0)).toString(),
    rawWithdrawableCollateralRaw: (collateral > rawFloorCollateral ? collateral - rawFloorCollateral : BigInt(0)).toString(),
    withdrawableCollateralRaw: (collateral > floorCollateral ? collateral - floorCollateral : BigInt(0)).toString(),
    healthFactorWad: healthFactorWad(rawCapacity, BORROW_FIXTURE_DEBT)!.toString(),
    liquidationPriceRaw: liquidationPriceRaw(BORROW_FIXTURE_DEBT, collateral, lltvWad)!.toString(),
  };
}


export function borrowOverviewBody({
  openMarketId = VERIFIED_MORPHO_MARKETS[2]!.marketId,
  urgentMarketId = null,
  unavailableMarketId = null,
}: {
  openMarketId?: string | null;
  urgentMarketId?: string | null;
  unavailableMarketId?: string | null;
} = {}): BorrowOverviewResponse {
  const source = {
    provider: "Base JSON-RPC" as const,
    blockNumber: "100",
    blockHash: BORROW_BLOCK_HASH,
    blockTimestamp: "1788897600",
    fetchedAt: BORROW_FETCHED_AT,
  };
  const snapshots: BorrowMarketSnapshot[] = VERIFIED_MORPHO_MARKETS.map((market, index) => {
    const active = market.marketId === openMarketId;
    const tokenUnit = BigInt(10) ** BigInt(market.collateralToken.decimals);
    const mode = market.capabilities.borrow!;
    return {
      version: "1",
      chainId: 8453,
      walletAddress: sessionBody.smartAccount.address as `0x${string}`,
      market: {
        id: market.marketId, morpho: market.morpho, loanToken: market.loanToken,
        collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm,
        lltvWad: market.lltvWad.toString(10), rank: market.rank,
      },
      eligibility: { mode, newRisk: mode === "enabled", reason: mode === "reducing-only" ? "New borrowing is paused. You can still repay or add collateral." : null },
      source,
      state: {
        oraclePriceRaw: BORROW_ORACLE_PRICES[index]!, borrowRatePerSecondWad: "1000000000",
        borrowAprWad: "31536000000000000", totalSupplyAssetsRaw: "1000000000",
        totalBorrowAssetsRaw: "500000000", totalBorrowSharesRaw: "500000000",
        liquidityAssetsRaw: "500000000", lastUpdateTimestamp: "1788897500",
      },
      wallet: { collateralBalanceRaw: (BigInt(2) * tokenUnit).toString(), loanBalanceRaw: "200000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
      position: active
        ? borrowFixturePosition(BORROW_ORACLE_PRICES[index]!, market.lltvWad, BigInt(market.marketId === urgentMarketId ? "1200000000000000000" : "1600000000000000000"))
        : {
            collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", rawBorrowCapacityAssetsRaw: "0", borrowCapacityAssetsRaw: "0",
            rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null,
          },
    };
  });
  const opportunities: BorrowOverviewResponse["opportunities"] = snapshots.map((snapshot) => ({
    market: snapshot.market,
    availability: snapshot.market.id === unavailableMarketId
      ? { status: "unavailable", mode: snapshot.eligibility.mode, reason: "Current verified chain state is unavailable for this market.", source: null }
      : { status: "available", mode: snapshot.eligibility.mode, reason: null, source, snapshot },
  }));
  return {
    version: "2", chainId: 8453,
    owner: { address: sessionBody.smartAccount.address as `0x${string}`, accountProvider: "cdp-embedded" },
    discovery: {
      status: unavailableMarketId ? "partial" : "complete",
      sourceBlock: { provider: source.provider, blockNumber: source.blockNumber, blockHash: source.blockHash, blockTimestamp: source.blockTimestamp },
      candidateCount: opportunities.length, verifiedCount: opportunities.filter((entry) => entry.availability.status === "available").length,
      reason: unavailableMarketId ? "One Borrow market could not be verified." : null,
      fetchedAt: BORROW_FETCHED_AT,
    },
    opportunities,
    positions: opportunities.flatMap((entry) => entry.availability.status === "available" && BigInt(entry.availability.snapshot.position.debtAssetsRaw) > BigInt(0)
      ? [{ market: entry.market, source, collateralRaw: entry.availability.snapshot.position.collateralRaw, borrowSharesRaw: entry.availability.snapshot.position.borrowSharesRaw, debtAssetsRaw: entry.availability.snapshot.position.debtAssetsRaw, healthFactorWad: entry.availability.snapshot.position.healthFactorWad }]
      : []),
  };
}

export function savingsVaultsBody(stateAsOf: string, fetchedAt: string) {
  return {
    version: "v1",
    chainId: 8453,
    asset: { address: PORTFOLIO_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    candidates: [{
      version: "v1",
      vaultAddress: portfolioVaults[0].address,
      name: portfolioVaults[0].name,
      symbol: portfolioVaults[0].symbol,
      listed: true,
      chainId: 8453,
      asset: { address: PORTFOLIO_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      curatorAddress: null,
      grossApy: 0.04,
      netApy: 0.035,
      feeRate: 0.1,
      totalAssetsRaw: "100000000",
      liquidityRaw: "50000000",
      stateAsOf,
      blockNumber: "51026404",
      source: {
        provider: "Morpho GraphQL",
        endpoint: "https://api.morpho.org/graphql",
        query: "vaults",
        fetchedAt,
      },
    }],
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt,
    },
    stale: false,
  };
}
