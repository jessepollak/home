import type { FiatCurrencyCode } from "@/config/regions";

export type BaseAddress = `0x${string}`;
export type FundingAssetId = "base:usdc" | "base:wars" | "base:wbrl" | "base:wcop" | "base:idrx";

export const BASE_CHAIN_ID = 8453 as const;

export const BASE_ETH = {
  id: "eth",
  chainId: BASE_CHAIN_ID,
  name: "Ethereum",
  symbol: "ETH",
  decimals: 18,
  address: null,
} as const;

export const BASE_USDC = {
  id: "usdc",
  fundingId: "base:usdc",
  chainId: BASE_CHAIN_ID,
  name: "US dollar",
  symbol: "USDC",
  decimals: 6,
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  fiatCurrency: "USD",
  issuerDocsUrl: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
} as const;

export type BaseBrandMark = "btc" | "eth" | "xrp" | "doge" | "ada";

export type BaseCollateralAsset = {
  id: string;
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  displayName: string;
  symbol: string;
  decimals: number;
  address: BaseAddress;
  brandMark: BaseBrandMark;
  identitySource: string;
};

export const BASE_CBBTC = {
  id: "cbbtc",
  chainId: BASE_CHAIN_ID,
  name: "Coinbase Wrapped BTC",
  displayName: "Bitcoin",
  symbol: "cbBTC",
  decimals: 8,
  address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  brandMark: "btc",
  identitySource: "https://www.coinbase.com/cbbtc/proof-of-reserves",
} as const satisfies BaseCollateralAsset;

export const BASE_CBXRP = {
  id: "cbxrp",
  chainId: BASE_CHAIN_ID,
  name: "Coinbase Wrapped XRP",
  displayName: "XRP",
  symbol: "cbXRP",
  decimals: 6,
  address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
  brandMark: "xrp",
  identitySource: "https://www.coinbase.com/cbxrp/proof-of-reserves",
} as const satisfies BaseCollateralAsset;

export const BASE_CBETH = {
  id: "cbeth",
  chainId: BASE_CHAIN_ID,
  name: "Coinbase Wrapped Staked ETH",
  displayName: "Staked ETH",
  symbol: "cbETH",
  decimals: 18,
  address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  brandMark: "eth",
  identitySource: "https://www.coinbase.com/price/coinbase-wrapped-staked-eth",
} as const satisfies BaseCollateralAsset;

export const BASE_CBDOGE = {
  id: "cbdoge",
  chainId: BASE_CHAIN_ID,
  name: "Coinbase Wrapped DOGE",
  displayName: "Dogecoin",
  symbol: "cbDOGE",
  decimals: 8,
  address: "0xcbD06E5A2B0C65597161de254AA074E489dEb510",
  brandMark: "doge",
  identitySource: "https://www.coinbase.com/cbdoge/proof-of-reserves",
} as const satisfies BaseCollateralAsset;

export const BASE_CBADA = {
  id: "cbada",
  chainId: BASE_CHAIN_ID,
  name: "Coinbase Wrapped ADA",
  displayName: "Cardano",
  symbol: "cbADA",
  decimals: 6,
  address: "0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c",
  brandMark: "ada",
  identitySource: "https://www.coinbase.com/cbada/proof-of-reserves",
} as const satisfies BaseCollateralAsset;

export const BASE_BORROW_COLLATERAL_ASSETS = [
  BASE_CBBTC,
  BASE_CBXRP,
  BASE_CBETH,
  BASE_CBDOGE,
  BASE_CBADA,
] as const satisfies readonly BaseCollateralAsset[];

export const BASE_MORPHO_USDC_VAULTS = [
  {
    id: "morpho-steakhouse-usdc",
    name: "Gauntlet USDC Prime",
    symbol: "USDC vault",
    address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    decimals: 18,
  },
  {
    id: "morpho-gauntlet-usdc",
    name: "Spark USDC Vault",
    symbol: "USDC vault",
    address: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
    decimals: 18,
  },
  {
    id: "morpho-re7-usdc",
    name: "Steakhouse USDC",
    symbol: "USDC vault",
    address: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
    decimals: 18,
  },
] as const satisfies readonly BaseVaultAsset[];

export const BASE_FUNDING_ASSETS = {
  "base:usdc": { ...BASE_USDC, id: "base:usdc" },
  "base:wars": {
    id: "base:wars",
    fundingId: "base:wars",
    chainId: BASE_CHAIN_ID,
    name: "Wrapped Argentine peso",
    symbol: "wARS",
    decimals: 18,
    address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
    fiatCurrency: "ARS",
    issuerDocsUrl: "https://www.ripio.com/es/assets/wars/whitepaper",
  },
  "base:wbrl": {
    id: "base:wbrl",
    fundingId: "base:wbrl",
    chainId: BASE_CHAIN_ID,
    name: "Wrapped Brazilian real",
    symbol: "wBRL",
    decimals: 18,
    address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0",
    fiatCurrency: "BRL",
    issuerDocsUrl: "https://docs.ripio.com/",
  },
  "base:wcop": {
    id: "base:wcop",
    fundingId: "base:wcop",
    chainId: BASE_CHAIN_ID,
    name: "Wrapped Colombian peso",
    symbol: "wCOP",
    decimals: 18,
    address: "0x8a1d45e102e886510e891d2ec656a708991e2d76",
    fiatCurrency: "COP",
    issuerDocsUrl: "https://action.ripio.com/es/blog/las-stablecoins-wfiat-ya-estan-disponibles-en-celo",
  },
  "base:idrx": {
    id: "base:idrx",
    fundingId: "base:idrx",
    chainId: BASE_CHAIN_ID,
    name: "Rupiah",
    symbol: "IDRX",
    decimals: 2,
    address: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
    fiatCurrency: "IDR",
    issuerDocsUrl: "https://docs.idrx.co/introduction/supported-chain-and-contract-address",
  },
} as const satisfies Record<FundingAssetId, BaseFundingAsset>;

export type BaseFundingAsset = {
  id: FundingAssetId;
  fundingId: string;
  chainId: typeof BASE_CHAIN_ID;
  name: string;
  symbol: string;
  decimals: number;
  address: BaseAddress;
  fiatCurrency: FiatCurrencyCode;
  issuerDocsUrl: string;
};
export type BaseVaultAsset = {
  id: string;
  name: string;
  symbol: string;
  address: BaseAddress;
  decimals: number;
};
