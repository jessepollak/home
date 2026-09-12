import type { FiatCurrencyCode } from "@/config/regions";

export const FUNDING_CHAIN_ID = 8453 as const;

export type FundingAssetId =
  | "base:usdc"
  | "base:wars"
  | "base:wcop"
  | "base:idrx";

export type FundingAsset = {
  id: FundingAssetId;
  chainId: typeof FUNDING_CHAIN_ID;
  address: `0x${string}`;
  decimals: number;
  symbol: string;
  fiatCurrency: FiatCurrencyCode;
  issuerDocsUrl: string;
};

export const fundingAssets = {
  "base:usdc": {
    id: "base:usdc",
    chainId: FUNDING_CHAIN_ID,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    symbol: "USDC",
    fiatCurrency: "USD",
    issuerDocsUrl: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
  },
  "base:wars": {
    id: "base:wars",
    chainId: FUNDING_CHAIN_ID,
    address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
    decimals: 18,
    symbol: "wARS",
    fiatCurrency: "ARS",
    issuerDocsUrl: "https://www.ripio.com/es/assets/wars/whitepaper",
  },
  "base:wcop": {
    id: "base:wcop",
    chainId: FUNDING_CHAIN_ID,
    address: "0x8a1d45e102e886510e891d2ec656a708991e2d76",
    decimals: 18,
    symbol: "wCOP",
    fiatCurrency: "COP",
    issuerDocsUrl: "https://action.ripio.com/es/blog/las-stablecoins-wfiat-ya-estan-disponibles-en-celo",
  },
  "base:idrx": {
    id: "base:idrx",
    chainId: FUNDING_CHAIN_ID,
    address: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
    decimals: 2,
    symbol: "IDRX",
    fiatCurrency: "IDR",
    issuerDocsUrl: "https://docs.idrx.co/introduction/supported-chain-and-contract-address",
  },
} as const satisfies Record<FundingAssetId, FundingAsset>;

export function getFundingAsset(id: string): FundingAsset | undefined {
  return Object.prototype.hasOwnProperty.call(fundingAssets, id)
    ? fundingAssets[id as FundingAssetId]
    : undefined;
}
