import { BASE_CBBTC, BASE_CHAIN_ID, BASE_USDC } from "@/shared/assets/base";

export type MorphoAddress = `0x${string}`;
export type MorphoMarketId = `0x${string}`;
export type MorphoAssetRef = {
  id: `eip155:8453/erc20:0x${string}`;
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  address: MorphoAddress;
};
export type MorphoMarketCapability = "enabled" | "reducing-only";
export type VerifiedMorphoMarketRef = {
  chainId: typeof BASE_CHAIN_ID;
  morpho: MorphoAddress;
  marketId: MorphoMarketId;
  loanToken: MorphoAssetRef;
  collateralToken: MorphoAssetRef;
  oracle: MorphoAddress;
  irm: MorphoAddress;
  lltvWad: bigint;
  rank: number;
  capabilities: {
    borrow?: MorphoMarketCapability;
  };
};

export { BASE_CHAIN_ID } from "@/shared/assets/base";
export const MORPHO_BLUE_ADDRESS =
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const satisfies MorphoAddress;
export const MORPHO_USDC_CBBTC_MARKET_ID =
  "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836" as const;

function morphoAsset(asset: {
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  address: MorphoAddress;
}): MorphoAssetRef {
  return {
    ...asset,
    id: `eip155:8453/erc20:${asset.address.toLowerCase()}` as MorphoAssetRef["id"],
  };
}

export const MORPHO_USDC_CBBTC_LOAN_TOKEN = morphoAsset(BASE_USDC);
export const MORPHO_USDC_CBBTC_COLLATERAL_TOKEN = morphoAsset(BASE_CBBTC);
export const MORPHO_USDC_CBBTC_ORACLE_ADDRESS =
  "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9" as const satisfies MorphoAddress;
export const MORPHO_USDC_CBBTC_IRM_ADDRESS =
  "0x46415998764C29aB2a25CbeA6254146D50D22687" as const satisfies MorphoAddress;
export const MORPHO_USDC_CBBTC_LLTV_WAD = BigInt("860000000000000000");

export const VERIFIED_MORPHO_MARKETS = [
  {
    chainId: BASE_CHAIN_ID,
    morpho: MORPHO_BLUE_ADDRESS,
    marketId: MORPHO_USDC_CBBTC_MARKET_ID,
    loanToken: MORPHO_USDC_CBBTC_LOAN_TOKEN,
    collateralToken: MORPHO_USDC_CBBTC_COLLATERAL_TOKEN,
    oracle: MORPHO_USDC_CBBTC_ORACLE_ADDRESS,
    irm: MORPHO_USDC_CBBTC_IRM_ADDRESS,
    lltvWad: MORPHO_USDC_CBBTC_LLTV_WAD,
    rank: 1,
    capabilities: { borrow: "enabled" },
  },
] as const satisfies readonly VerifiedMorphoMarketRef[];

export const DEFAULT_VERIFIED_MORPHO_MARKET = VERIFIED_MORPHO_MARKETS[0];
export const MORPHO_USDC_CBBTC_MARKET_PARAMS = {
  loanToken: MORPHO_USDC_CBBTC_LOAN_TOKEN.address,
  collateralToken: MORPHO_USDC_CBBTC_COLLATERAL_TOKEN.address,
  oracle: MORPHO_USDC_CBBTC_ORACLE_ADDRESS,
  irm: MORPHO_USDC_CBBTC_IRM_ADDRESS,
  lltv: MORPHO_USDC_CBBTC_LLTV_WAD,
} as const;

export function getVerifiedMorphoMarket(marketId: string): VerifiedMorphoMarketRef | null {
  return VERIFIED_MORPHO_MARKETS.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null;
}
