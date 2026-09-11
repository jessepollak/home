export const PORTFOLIO_BASE_CHAIN_ID = 8453 as const;
export const PORTFOLIO_BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export type VerifiedPortfolioSession = {
  subject: string;
  smartAccountAddress: `0x${string}`;
  chainId: typeof PORTFOLIO_BASE_CHAIN_ID;
};

export type PortfolioAssetBalance =
  | {
      id: "usdc";
      symbol: "USDC";
      decimals: 6;
      kind: "erc20";
      tokenAddress: typeof PORTFOLIO_BASE_USDC_ADDRESS;
      balanceBaseUnits: string;
    }
  | {
      id: "eth";
      symbol: "ETH";
      decimals: 18;
      kind: "native";
      balanceBaseUnits: string;
    };

export type PortfolioSnapshot = {
  walletAddress: `0x${string}`;
  chainId: typeof PORTFOLIO_BASE_CHAIN_ID;
  blockNumber: string;
  blockHash: `0x${string}`;
  blockTimestamp: string;
  fetchedAt: string;
  assets: PortfolioAssetBalance[];
};

export type PortfolioState =
  | { status: "unavailable"; snapshot: null; error: null }
  | { status: "loading"; snapshot: null; error: null }
  | { status: "ready"; snapshot: PortfolioSnapshot; error: null }
  | { status: "error"; snapshot: null; error: "portfolio-unavailable" };

export type FetchPortfolio = (signal: AbortSignal) => Promise<unknown>;
