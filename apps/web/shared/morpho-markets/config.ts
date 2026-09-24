import {
  BASE_CBADA,
  BASE_CBBTC,
  BASE_CBDOGE,
  BASE_CBETH,
  BASE_CBXRP,
  BASE_CHAIN_ID,
  BASE_USDC,
  type BaseBrandMark,
  type BaseCollateralAsset,
} from "@/shared/assets/base";

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
export type MorphoCollateralDisplay = {
  name: string;
  brandMark: BaseBrandMark;
};
export type VerifiedMorphoMarketRef = {
  chainId: typeof BASE_CHAIN_ID;
  morpho: MorphoAddress;
  marketId: MorphoMarketId;
  loanToken: MorphoAssetRef;
  collateralToken: MorphoAssetRef;
  collateralDisplay: MorphoCollateralDisplay;
  oracle: MorphoAddress;
  irm: MorphoAddress;
  lltvWad: bigint;
  rank: number;
  capabilities: {
    borrow?: MorphoMarketCapability;
  };
};

export {
  BASE_CHAIN_ID,
} from "@/shared/assets/base";
export const MORPHO_BLUE_ADDRESS =
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const satisfies MorphoAddress;
export const MORPHO_ADAPTIVE_CURVE_IRM_ADDRESS =
  "0x46415998764C29aB2a25CbeA6254146D50D22687" as const satisfies MorphoAddress;

function morphoAsset(asset: {
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  address: MorphoAddress;
}): MorphoAssetRef {
  return {
    chainId: asset.chainId,
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    address: asset.address,
    id: `eip155:8453/erc20:${asset.address.toLowerCase()}` as MorphoAssetRef["id"],
  };
}

const USDC_LOAN_TOKEN = morphoAsset(BASE_USDC);

function usdcMarket(entry: {
  marketId: MorphoMarketId;
  collateral: BaseCollateralAsset;
  oracle: MorphoAddress;
  lltvWad: bigint;
  rank: number;
  capabilities: VerifiedMorphoMarketRef["capabilities"];
}): VerifiedMorphoMarketRef {
  return {
    chainId: BASE_CHAIN_ID,
    morpho: MORPHO_BLUE_ADDRESS,
    marketId: entry.marketId,
    loanToken: USDC_LOAN_TOKEN,
    collateralToken: morphoAsset(entry.collateral),
    collateralDisplay: { name: entry.collateral.displayName, brandMark: entry.collateral.brandMark },
    oracle: entry.oracle,
    irm: MORPHO_ADAPTIVE_CURVE_IRM_ADDRESS,
    lltvWad: entry.lltvWad,
    rank: entry.rank,
    capabilities: entry.capabilities,
  };
}

export const VERIFIED_MORPHO_MARKETS: readonly VerifiedMorphoMarketRef[] = [
  usdcMarket({
    marketId: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
    collateral: BASE_CBBTC,
    oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
    lltvWad: BigInt("860000000000000000"),
    rank: 1,
    capabilities: { borrow: "enabled" },
  }),
  usdcMarket({
    marketId: "0xd4a903dc6d949519060c7707f9604fdc9772c046e05c2e3a8fce0bd7196e4109",
    collateral: BASE_CBXRP,
    oracle: "0x031b2EFC8d70042Ac8d9f5c793c4149eC4b60fdE",
    lltvWad: BigInt("625000000000000000"),
    rank: 2,
    capabilities: { borrow: "enabled" },
  }),
  usdcMarket({
    marketId: "0x0ca10126f6c94cbd9cf0a48cc9516ae5e3dec5aa68303e6d988ee37c5149bf0d",
    collateral: BASE_CBETH,
    oracle: "0x97FF9CbD7E77348b2B8FfBB883bF29452aD18295",
    lltvWad: BigInt("770000000000000000"),
    rank: 3,
    capabilities: { borrow: "enabled" },
  }),
  usdcMarket({
    marketId: "0x73527ddd796e6d4f48387adaae36f6f3d49d606d7f2a15eb0c931416a58875d8",
    collateral: BASE_CBDOGE,
    oracle: "0xA9D36600Fb9eba7548857e61F836Ec951e3091B2",
    lltvWad: BigInt("625000000000000000"),
    rank: 4,
    capabilities: { borrow: "enabled" },
  }),
  usdcMarket({
    marketId: "0xd7520ad198b497b6eb75bc690268f4597630dbc12e305e9d4105843bab36e41d",
    collateral: BASE_CBADA,
    oracle: "0x35D87a743D1F2f7CaFb42D855dC1c5Df857Ce45f",
    lltvWad: BigInt("625000000000000000"),
    rank: 5,
    capabilities: { borrow: "enabled" },
  }),
];

/** @public exercised by shared/morpho-markets/config.test.ts */
export function getVerifiedMorphoMarket(marketId: string): VerifiedMorphoMarketRef | null {
  return VERIFIED_MORPHO_MARKETS.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null;
}
