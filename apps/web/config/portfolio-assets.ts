import { investAssets } from "./invest-assets";
import type { FiatCurrencyCode } from "./regions";
import {
  BASE_CHAIN_ID,
  BASE_ETH,
  BASE_FUNDING_ASSETS,
  BASE_MORPHO_USDC_VAULTS,
  BASE_USDC,
} from "@/shared/assets/base";

export const PORTFOLIO_NATIVE_ASSET_KEY = `eip155:${BASE_CHAIN_ID}/native` as const;
export const PORTFOLIO_USDC_ADDRESS = BASE_USDC.address;
export const PORTFOLIO_USDC_ASSET_KEY =
  `eip155:${BASE_CHAIN_ID}/erc20:${BASE_USDC.address.toLowerCase()}` as const;

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

export const canonicalUsdcAsset = {
  id: "usdc",
  assetKey: PORTFOLIO_USDC_ASSET_KEY,
  name: "US dollar",
  symbol: "USDC",
  decimals: BASE_USDC.decimals,
  kind: "erc20",
  contractAddress: PORTFOLIO_USDC_ADDRESS,
  cashCurrency: "USD",
} as const satisfies DirectPortfolioAsset;

export const nativeEthAsset = {
  id: "eth",
  assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
  name: "Ethereum",
  symbol: "ETH",
  decimals: BASE_ETH.decimals,
  kind: "native",
  contractAddress: null,
  cashCurrency: null,
} as const satisfies DirectPortfolioAsset;

export const investPortfolioAssets = investAssets.map((asset) => {
  const decimals = asset.representation.decimals;
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
    assetKey: assetKeyForErc20(BASE_FUNDING_ASSETS["base:idrx"].address),
    name: "Rupiah",
    symbol: BASE_FUNDING_ASSETS["base:idrx"].symbol,
    decimals: BASE_FUNDING_ASSETS["base:idrx"].decimals,
    kind: "erc20",
    contractAddress: BASE_FUNDING_ASSETS["base:idrx"].address,
    cashCurrency: BASE_FUNDING_ASSETS["base:idrx"].fiatCurrency,
  },
  ARS: {
    id: "wars",
    assetKey: assetKeyForErc20(BASE_FUNDING_ASSETS["base:wars"].address),
    name: "Argentine peso",
    symbol: BASE_FUNDING_ASSETS["base:wars"].symbol,
    decimals: BASE_FUNDING_ASSETS["base:wars"].decimals,
    kind: "erc20",
    contractAddress: BASE_FUNDING_ASSETS["base:wars"].address,
    cashCurrency: BASE_FUNDING_ASSETS["base:wars"].fiatCurrency,
  },
  BRL: {
    id: "wbrl",
    assetKey: assetKeyForErc20(BASE_FUNDING_ASSETS["base:wbrl"].address),
    name: "Brazilian real",
    symbol: BASE_FUNDING_ASSETS["base:wbrl"].symbol,
    decimals: BASE_FUNDING_ASSETS["base:wbrl"].decimals,
    kind: "erc20",
    contractAddress: BASE_FUNDING_ASSETS["base:wbrl"].address,
    cashCurrency: BASE_FUNDING_ASSETS["base:wbrl"].fiatCurrency,
  },
  COP: {
    id: "wcop",
    assetKey: assetKeyForErc20(BASE_FUNDING_ASSETS["base:wcop"].address),
    name: "Colombian peso",
    symbol: BASE_FUNDING_ASSETS["base:wcop"].symbol,
    decimals: BASE_FUNDING_ASSETS["base:wcop"].decimals,
    kind: "erc20",
    contractAddress: BASE_FUNDING_ASSETS["base:wcop"].address,
    cashCurrency: BASE_FUNDING_ASSETS["base:wcop"].fiatCurrency,
  },
} as const satisfies Partial<Record<FiatCurrencyCode, DirectPortfolioAsset>>;

const verifiedCashCurrencyByContract = new Map<string, FiatCurrencyCode>([
  [canonicalUsdcAsset.contractAddress.toLowerCase(), canonicalUsdcAsset.cashCurrency],
  ...Object.values(verifiedLocalCashAssets).map(
    (asset) => [asset.contractAddress.toLowerCase(), asset.cashCurrency] as const,
  ),
]);

export function verifiedCashCurrency(contractAddress: string | null | undefined): FiatCurrencyCode | null {
  return contractAddress ? verifiedCashCurrencyByContract.get(contractAddress.toLowerCase()) ?? null : null;
}

export const portfolioVaults = BASE_MORPHO_USDC_VAULTS;

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

function assertUniqueAssetKeys(keys: readonly string[]): void {
  if (new Set(keys).size !== keys.length) {
    throw new Error("The supported portfolio inventory contains a duplicate asset.");
  }
}
