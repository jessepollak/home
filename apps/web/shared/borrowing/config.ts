import { BASE_CBBTC, BASE_CHAIN_ID, BASE_USDC } from "@/shared/assets/base";

export type BorrowAddress = `0x${string}`;
export type BorrowMarketId = `0x${string}`;
export type BorrowAssetRef = {
  id: `eip155:8453/erc20:0x${string}`;
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  address: BorrowAddress;
};
export type BorrowMarketRef = {
  chainId: typeof BASE_CHAIN_ID;
  morpho: BorrowAddress;
  marketId: BorrowMarketId;
  loanToken: BorrowAssetRef;
  collateralToken: BorrowAssetRef;
  oracle: BorrowAddress;
  irm: BorrowAddress;
  lltvWad: bigint;
  rank: number;
  availability: "enabled" | "reducing-only";
};

export { BASE_CHAIN_ID } from "@/shared/assets/base";
export const MORPHO_BLUE_ADDRESS =
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const satisfies BorrowAddress;
export const BORROW_MARKET_ID =
  "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836" as const;

function borrowAsset(asset: {
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  address: BorrowAddress;
}): BorrowAssetRef {
  return {
    ...asset,
    id: `eip155:8453/erc20:${asset.address.toLowerCase()}` as BorrowAssetRef["id"],
  };
}

export const BORROW_LOAN_TOKEN = borrowAsset(BASE_USDC);
export const BORROW_COLLATERAL_TOKEN = borrowAsset(BASE_CBBTC);
export const BORROW_ORACLE_ADDRESS =
  "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9" as const satisfies BorrowAddress;
export const BORROW_IRM_ADDRESS =
  "0x46415998764C29aB2a25CbeA6254146D50D22687" as const satisfies BorrowAddress;
export const BORROW_LLTV_WAD = BigInt("860000000000000000");

export const BORROW_LIQUIDATION_HEALTH_WAD = BigInt("1000000000000000000");
export const BORROW_HEALTH_CRITICAL_WAD = BigInt("1100000000000000000");
export const BORROW_HEALTH_FLOOR_WAD = BigInt("1250000000000000000");
export const BORROW_HEALTH_BUFFER_WAD = BigInt("1500000000000000000");

export const BORROW_MARKETS = [
  {
    chainId: BASE_CHAIN_ID,
    morpho: MORPHO_BLUE_ADDRESS,
    marketId: BORROW_MARKET_ID,
    loanToken: BORROW_LOAN_TOKEN,
    collateralToken: BORROW_COLLATERAL_TOKEN,
    oracle: BORROW_ORACLE_ADDRESS,
    irm: BORROW_IRM_ADDRESS,
    lltvWad: BORROW_LLTV_WAD,
    rank: 1,
    availability: "enabled",
  },
] as const satisfies readonly BorrowMarketRef[];

export const DEFAULT_BORROW_MARKET = BORROW_MARKETS[0];
export const BORROW_MARKET_PARAMS = {
  loanToken: DEFAULT_BORROW_MARKET.loanToken.address,
  collateralToken: DEFAULT_BORROW_MARKET.collateralToken.address,
  oracle: DEFAULT_BORROW_MARKET.oracle,
  irm: DEFAULT_BORROW_MARKET.irm,
  lltv: DEFAULT_BORROW_MARKET.lltvWad,
} as const;

export function getBorrowMarketRef(marketId: string): BorrowMarketRef | null {
  return BORROW_MARKETS.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null;
}

export const BORROW_SOURCE = {
  provider: "Morpho and Base JSON-RPC",
  verifiedOn: "2026-09-08",
} as const;
