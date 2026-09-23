import {
  DEFAULT_VERIFIED_MORPHO_MARKET,
  MORPHO_USDC_CBBTC_COLLATERAL_TOKEN,
  MORPHO_USDC_CBBTC_IRM_ADDRESS,
  MORPHO_USDC_CBBTC_LLTV_WAD,
  MORPHO_USDC_CBBTC_LOAN_TOKEN,
  MORPHO_USDC_CBBTC_MARKET_ID,
  MORPHO_USDC_CBBTC_MARKET_PARAMS,
  MORPHO_USDC_CBBTC_ORACLE_ADDRESS,
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

/** @public exercised by client/borrowing/borrow-ui.test.ts */
export {
  MORPHO_BLUE_ADDRESS,
} from "@/shared/morpho-markets/config";

/** @public exercised by client/borrowing/borrow-ui.test.ts */
export const BORROW_MARKET_ID = MORPHO_USDC_CBBTC_MARKET_ID;
/** @public exercised by client/borrowing/borrow-ui.test.ts */
export const BORROW_LOAN_TOKEN = MORPHO_USDC_CBBTC_LOAN_TOKEN;
/** @public exercised by client/borrowing/borrow-ui.test.ts */
export const BORROW_COLLATERAL_TOKEN = MORPHO_USDC_CBBTC_COLLATERAL_TOKEN;
/** @public exercised by client/borrowing/borrow-ui.test.ts */
export const BORROW_ORACLE_ADDRESS = MORPHO_USDC_CBBTC_ORACLE_ADDRESS;
/** @public exercised by client/borrowing/borrow-ui.test.ts */
export const BORROW_IRM_ADDRESS = MORPHO_USDC_CBBTC_IRM_ADDRESS;
/** @public exercised by client/borrowing/borrow-ui.test.ts */
export const BORROW_LLTV_WAD = MORPHO_USDC_CBBTC_LLTV_WAD;

export const BORROW_LIQUIDATION_HEALTH_WAD = BigInt("1000000000000000000");
export const BORROW_HEALTH_CRITICAL_WAD = BigInt("1100000000000000000");
export const BORROW_HEALTH_FLOOR_WAD = BigInt("1250000000000000000");
export const BORROW_HEALTH_BUFFER_WAD = BigInt("1500000000000000000");

export const BORROW_MARKETS: readonly BorrowMarketRef[] = VERIFIED_MORPHO_MARKETS.flatMap((market): BorrowMarketRef[] => {
  const availability = market.capabilities.borrow;
  return availability ? [{ ...market, availability }] : [];
});

const defaultBorrowMarket = BORROW_MARKETS.find(
  (market) => market.marketId === DEFAULT_VERIFIED_MORPHO_MARKET.marketId,
);
if (!defaultBorrowMarket) throw new Error("The default verified Morpho market must support Borrow.");
/** @public exercised by server/borrowing/handler.test.ts */
export const DEFAULT_BORROW_MARKET = defaultBorrowMarket;
/** @public exercised by shared/borrowing/config.test.ts */
export const BORROW_MARKET_PARAMS = MORPHO_USDC_CBBTC_MARKET_PARAMS;

export function getBorrowMarketRef(marketId: string): BorrowMarketRef | null {
  return BORROW_MARKETS.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null;
}
