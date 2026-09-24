import {
  VERIFIED_MORPHO_MARKETS,
  type MorphoAddress,
  type MorphoAssetRef,
  type MorphoMarketId,
  type VerifiedMorphoMarketRef,
} from "@/shared/morpho-markets/config";

export type BorrowAddress = MorphoAddress;
export type BorrowMarketId = MorphoMarketId;
export type BorrowAssetRef = MorphoAssetRef;
export type BorrowMarketRef = VerifiedMorphoMarketRef & {
  availability: NonNullable<VerifiedMorphoMarketRef["capabilities"]["borrow"]>;
};

export const BORROW_LIQUIDATION_HEALTH_WAD = BigInt("1000000000000000000");
export const BORROW_HEALTH_CRITICAL_WAD = BigInt("1100000000000000000");
export const BORROW_HEALTH_FLOOR_WAD = BigInt("1250000000000000000");
export const BORROW_HEALTH_BUFFER_WAD = BigInt("1500000000000000000");

export const BORROW_MARKETS: readonly BorrowMarketRef[] = VERIFIED_MORPHO_MARKETS.flatMap((market): BorrowMarketRef[] => {
  const availability = market.capabilities.borrow;
  return availability ? [{ ...market, availability }] : [];
});

/** @public test fixture anchor: first registry market */
export const DEFAULT_BORROW_MARKET = BORROW_MARKETS[0] ?? (() => { throw new Error("Borrow registry has no markets."); })();

export function getBorrowMarketRef(marketId: string): BorrowMarketRef | null {
  return BORROW_MARKETS.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null;
}
