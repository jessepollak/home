import "server-only";

import { getDirectPortfolioAssets, type PortfolioAddress } from "@/config/portfolio-assets";
import {
  createMorphoMarketRpcReader, type MorphoMarketRpcReader, type MorphoPinnedBlock,
} from "@/server/morpho-markets/rpc";
import { BORROW_MARKETS, getBorrowMarketRef, type BorrowMarketRef } from "@/shared/borrowing/config";
import { erc20AssetKey, type BalancesBorrow, type BorrowMarketKey, type BorrowPosition, type Holding } from "@/shared/balances/types";
import type { BorrowMarketRead, BorrowRead, ReadHolding } from "./types";

export const BALANCES_BORROW_DEADLINE_MS = 4_000;

type Dependencies = {
  readSnapshots?: MorphoMarketRpcReader["readSnapshots"];
  markets?: readonly BorrowMarketRef[];
  deadlineMs?: number;
};

export function createBorrowPositionsReader(dependencies: Dependencies = {}) {
  const markets = dependencies.markets ?? BORROW_MARKETS;
  const deadlineMs = dependencies.deadlineMs ?? BALANCES_BORROW_DEADLINE_MS;
  const reader = dependencies.readSnapshots ?? createMorphoMarketRpcReader().readSnapshots;

  return async function readBorrowPositions(owner: PortfolioAddress, at: MorphoPinnedBlock): Promise<BorrowRead> {
    const signal = AbortSignal.timeout(deadlineMs);
    try {
      const results = await reader(owner, markets, signal, at);
      return { markets: results.map(({ market, snapshot }): BorrowMarketRead => {
        const marketId = market.marketId.toLowerCase() as BorrowMarketKey;
        if (!snapshot) return { marketId, status: "unavailable" };
        return {
          marketId, status: "ready", blockNumber: snapshot.source.blockNumber,
          collateralRaw: snapshot.position.collateralRaw, debtAssetsRaw: snapshot.position.debtAssetsRaw,
          borrowAprWad: snapshot.state.borrowAprWad,
        };
      }) };
    } catch {
      return { markets: markets.map((market): BorrowMarketRead => ({
        marketId: market.marketId.toLowerCase() as BorrowMarketKey, status: "unavailable",
      })) };
    }
  };
}

export const readBorrowPositions = createBorrowPositionsReader();

export function borrowReadComplete(read: BorrowRead | null | undefined): boolean {
  return Boolean(read) && read!.markets.every((market) =>
    market.status === "ready" && (getBorrowMarketRef(market.marketId) !== null || emptyPosition(market))) &&
    BORROW_MARKETS.every((market) => read!.markets.some((entry) => entry.marketId === market.marketId.toLowerCase()));
}

function emptyPosition(market: Extract<BorrowMarketRead, { status: "ready" }>): boolean {
  return BigInt(market.collateralRaw) === BigInt(0) && BigInt(market.debtAssetsRaw) === BigInt(0);
}

type PricingPair = { marketId: BorrowMarketKey; borrowAprWad: string; collateral: ReadHolding; debt: ReadHolding };

export function borrowPricingPairs(read: BorrowRead | null | undefined): PricingPair[] {
  return (read?.markets ?? []).flatMap((entry): PricingPair[] => {
    if (entry.status !== "ready" || emptyPosition(entry)) return [];
    const market = getBorrowMarketRef(entry.marketId);
    if (!market) return [];
    return [{
      marketId: entry.marketId, borrowAprWad: entry.borrowAprWad,
      collateral: pricingHolding(market.collateralToken, `borrow-collateral:${entry.marketId}`, entry.collateralRaw),
      debt: pricingHolding(market.loanToken, `borrow-debt:${entry.marketId}`, entry.debtAssetsRaw),
    }];
  });
}

export function assembleBorrow(read: BorrowRead | null | undefined, pairs: readonly PricingPair[], price: (holding: ReadHolding) => Holding): BalancesBorrow {
  return {
    coverage: borrowReadComplete(read) ? "complete" : "partial",
    positions: pairs.map((pair): BorrowPosition => {
      const collateral = price(pair.collateral);
      const debt = price(pair.debt);
      return {
        marketId: pair.marketId,
        collateral: {
          ...collateral, kind: "erc20", source: "borrow",
          balance: { status: "ready", baseUnits: pair.collateral.balance.baseUnits! },
          collateral: { marketId: pair.marketId },
        },
        debt: {
          sign: -1, marketId: pair.marketId,
          asset: {
            key: erc20AssetKey(pair.debt.contractAddress!), name: pair.debt.name,
            symbol: pair.debt.symbol, decimals: pair.debt.decimals,
          },
          balance: { status: "ready", baseUnits: pair.debt.balance.baseUnits! }, value: debt.value,
        },
        borrowAprWad: pair.borrowAprWad,
      };
    }),
  };
}

function pricingHolding(asset: BorrowMarketRef["collateralToken"], id: string, baseUnits: string): ReadHolding {
  const key = erc20AssetKey(asset.address);
  const registry = getDirectPortfolioAssets().find((entry) => entry.assetKey === key);
  return {
    key, id, kind: "erc20", source: "borrow", name: registry?.name ?? asset.name,
    symbol: registry?.symbol ?? asset.symbol, decimals: asset.decimals,
    contractAddress: asset.address.toLowerCase() as `0x${string}`, cashCurrency: null,
    balance: { status: "ready", baseUnits },
  };
}
