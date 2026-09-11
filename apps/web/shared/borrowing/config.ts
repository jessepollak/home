export type BorrowAddress = `0x${string}`;

export const BASE_CHAIN_ID = 8453 as const;
export const MORPHO_BLUE_ADDRESS =
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const satisfies BorrowAddress;
export const BORROW_MARKET_ID =
  "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836" as const;
export const BORROW_LOAN_TOKEN = {
  id: "usdc",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as BorrowAddress,
  symbol: "USDC",
  decimals: 6,
} as const;
export const BORROW_COLLATERAL_TOKEN = {
  id: "cbbtc",
  address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as BorrowAddress,
  symbol: "cbBTC",
  decimals: 8,
} as const;
export const BORROW_ORACLE_ADDRESS =
  "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9" as const satisfies BorrowAddress;
export const BORROW_IRM_ADDRESS =
  "0x46415998764C29aB2a25CbeA6254146D50D22687" as const satisfies BorrowAddress;
export const BORROW_LLTV_WAD = BigInt("860000000000000000");

export const BORROW_MARKET_PARAMS = {
  loanToken: BORROW_LOAN_TOKEN.address,
  collateralToken: BORROW_COLLATERAL_TOKEN.address,
  oracle: BORROW_ORACLE_ADDRESS,
  irm: BORROW_IRM_ADDRESS,
  lltv: BORROW_LLTV_WAD,
} as const;

export const BORROW_SOURCE = {
  provider: "Morpho public API and Base JSON-RPC",
  metadataEndpoint:
    "https://api.morpho.org/v0/blue/markets/8453:0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
  verifiedOn: "2026-09-08",
} as const;
