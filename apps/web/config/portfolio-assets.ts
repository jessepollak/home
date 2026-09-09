import { investAssets } from "./invest-assets";
import type { FiatCurrencyCode } from "./regions";

export const PORTFOLIO_BASE_CHAIN_ID = 8453 as const;
export const PORTFOLIO_NATIVE_ASSET_KEY = "eip155:8453/native" as const;
export const PORTFOLIO_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const PORTFOLIO_USDC_ASSET_KEY =
  "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

export type PortfolioAddress = `0x${string}`;
export type PortfolioAssetKey =
  | typeof PORTFOLIO_NATIVE_ASSET_KEY
  | `eip155:8453/erc20:${string}`;

export type DirectPortfolioAsset = {
  id: string;
  assetKey: PortfolioAssetKey;
  name: string;
  symbol: string;
  decimals: number;
  kind: "native" | "erc20";
  contractAddress: PortfolioAddress | null;
  cashCurrency: FiatCurrencyCode | null;
};

const verifiedInvestDecimals: Readonly<Record<string, number>> = {
  nvdac: 8,
  metac: 8,
  aaplc: 8,
  googlc: 8,
  amznc: 8,
  msftc: 8,
  mstrc: 8,
  sndkc: 8,
  spcxc: 8,
  tslac: 8,
  cbbtc: 8,
  cbxrp: 6,
  cbdoge: 8,
  cbltc: 8,
  cbada: 6,
  degen: 18,
  toshi: 18,
};

export const canonicalUsdcAsset = {
  id: "usdc",
  assetKey: PORTFOLIO_USDC_ASSET_KEY,
  name: "US dollar",
  symbol: "USDC",
  decimals: 6,
  kind: "erc20",
  contractAddress: PORTFOLIO_USDC_ADDRESS,
  cashCurrency: "USD",
} as const satisfies DirectPortfolioAsset;

export const nativeEthAsset = {
  id: "eth",
  assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
  name: "Ethereum",
  symbol: "ETH",
  decimals: 18,
  kind: "native",
  contractAddress: null,
  cashCurrency: null,
} as const satisfies DirectPortfolioAsset;

export const investPortfolioAssets = investAssets.map((asset) => {
  const decimals = verifiedInvestDecimals[asset.id];
  if (decimals === undefined) {
    throw new Error(`Missing verified decimals for ${asset.id}.`);
  }
  return {
    id: asset.id,
    assetKey: `eip155:8453/erc20:${asset.contractAddress.toLowerCase()}`,
    name: asset.displayName,
    symbol: asset.representation.tokenSymbol,
    decimals,
    kind: "erc20",
    contractAddress: asset.contractAddress,
    cashCurrency: null,
  } satisfies DirectPortfolioAsset;
});

export const verifiedLocalCashAssets = {
  EUR: {
    id: "eurc",
    assetKey:
      "eip155:8453/erc20:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
    name: "Euro",
    symbol: "EURC",
    decimals: 6,
    kind: "erc20",
    contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
    cashCurrency: "EUR",
  },
  IDR: {
    id: "idrx",
    assetKey:
      "eip155:8453/erc20:0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
    name: "Indonesian rupiah",
    symbol: "IDRX",
    decimals: 2,
    kind: "erc20",
    contractAddress: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
    cashCurrency: "IDR",
  },
} as const satisfies Partial<Record<FiatCurrencyCode, DirectPortfolioAsset>>;

export const portfolioVaults = [
  {
    id: "morpho-steakhouse-usdc",
    name: "Steakhouse USDC vault",
    symbol: "USDC vault",
    address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    decimals: 18,
  },
  {
    id: "morpho-gauntlet-usdc",
    name: "Gauntlet USDC Core vault",
    symbol: "USDC vault",
    address: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
    decimals: 18,
  },
  {
    id: "morpho-re7-usdc",
    name: "Re7 USDC vault",
    symbol: "USDC vault",
    address: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
    decimals: 18,
  },
] as const;

export function assetKeyForErc20(address: string): `eip155:8453/erc20:${string}` {
  return `eip155:8453/erc20:${address.toLowerCase()}`;
}

export function getDirectPortfolioAssets(): DirectPortfolioAsset[] {
  const assets: DirectPortfolioAsset[] = [
    nativeEthAsset,
    canonicalUsdcAsset,
    ...investPortfolioAssets,
    ...Object.values(verifiedLocalCashAssets),
  ];
  assertUniqueAssetKeys(assets.map(({ assetKey }) => assetKey));
  return assets;
}

export function assertPortfolioRegistry(): void {
  const direct = getDirectPortfolioAssets();
  assertUniqueAssetKeys([
    ...direct.map(({ assetKey }) => assetKey),
    ...portfolioVaults.map(({ address }) => assetKeyForErc20(address)),
  ]);
  if (portfolioVaults.length !== 3 || investPortfolioAssets.length !== 17) {
    throw new Error("The supported portfolio inventory is outside its fixed bound.");
  }
}

function assertUniqueAssetKeys(keys: readonly string[]): void {
  if (new Set(keys).size !== keys.length) {
    throw new Error("The supported portfolio inventory contains a duplicate asset.");
  }
}
