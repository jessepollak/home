export const FUNDING_BASE_CHAIN_ID = 8453 as const;
export const FUNDING_BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const FUNDING_ASSETS = {
  usdc: {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    kind: "erc20",
    tokenAddress: FUNDING_BASE_USDC_ADDRESS,
  },
  eth: {
    id: "eth",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    kind: "native",
  },
} as const;

export type FundingAssetId = keyof typeof FUNDING_ASSETS;

export type HostedOnrampSession = {
  url: string;
  asset: {
    id: "usdc";
    symbol: "USDC";
    decimals: 6;
    tokenAddress: typeof FUNDING_BASE_USDC_ADDRESS;
  };
  network: {
    name: "Base";
    chainId: typeof FUNDING_BASE_CHAIN_ID;
  };
};
