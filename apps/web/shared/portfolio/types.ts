export const PORTFOLIO_BASE_CHAIN_ID = 8453 as const;
export const PORTFOLIO_BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const PORTFOLIO_BASE_USDC_DECIMALS = 6 as const;
export const PORTFOLIO_NATIVE_ETH_DECIMALS = 18 as const;

export const BASE_CHAIN_ID = PORTFOLIO_BASE_CHAIN_ID;
export const BASE_USDC_ADDRESS = PORTFOLIO_BASE_USDC_ADDRESS;
export const BASE_USDC_DECIMALS = PORTFOLIO_BASE_USDC_DECIMALS;
export const NATIVE_ETH_DECIMALS = PORTFOLIO_NATIVE_ETH_DECIMALS;

export type Address = `0x${string}`;

export type VerifiedPortfolioSession = {
  subject: string;
  smartAccountAddress: Address;
  chainId: typeof PORTFOLIO_BASE_CHAIN_ID;
};

export type PortfolioAssetBalance =
  | {
      id: "usdc";
      symbol: "USDC";
      decimals: typeof PORTFOLIO_BASE_USDC_DECIMALS;
      kind: "erc20";
      tokenAddress: typeof PORTFOLIO_BASE_USDC_ADDRESS;
      balanceBaseUnits: string;
    }
  | {
      id: "eth";
      symbol: "ETH";
      decimals: typeof PORTFOLIO_NATIVE_ETH_DECIMALS;
      kind: "native";
      balanceBaseUnits: string;
    };

export type PortfolioSnapshot = {
  walletAddress: Address;
  chainId: typeof PORTFOLIO_BASE_CHAIN_ID;
  blockNumber: string;
  blockHash: `0x${string}`;
  blockTimestamp: string;
  fetchedAt: string;
  assets: PortfolioAssetBalance[];
};

export type VerifiedPortfolioAccount = {
  address: Address;
  chainId: typeof PORTFOLIO_BASE_CHAIN_ID;
  verification: "session-smart-account";
};

export type PortfolioState =
  | { status: "unavailable"; snapshot: null; error: null }
  | { status: "loading"; snapshot: null; error: null }
  | { status: "ready"; snapshot: PortfolioSnapshot; error: null }
  | { status: "error"; snapshot: null; error: "portfolio-unavailable" };

export type FetchPortfolio = (signal: AbortSignal) => Promise<unknown>;
