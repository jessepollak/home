import { investAssets } from "./invest-assets";
import type { FiatCurrencyCode } from "./regions";
import { BASE_CHAIN_ID, BASE_ETH, BASE_MORPHO_USDC_VAULTS } from "@/shared/assets/base";
import {
  approvedCashCurrencies,
  approvedCashRecordForCurrency,
  CURRENCY_REGISTRY,
  currencyRecordById,
  recordsWithPreservedHoldings,
} from "@/shared/currencies/registry";
import type { CurrencyRepresentation } from "@/shared/currencies/types";

export const PORTFOLIO_NATIVE_ASSET_KEY = `eip155:${BASE_CHAIN_ID}/native` as const;
const usdcRecord = currencyRecordById("base:usdc");
if (!usdcRecord) throw new Error("The supported portfolio inventory has no USDC record.");
const usdcRecordId = usdcRecord.id;
export const PORTFOLIO_USDC_ADDRESS = usdcRecord.contractAddress;
export const PORTFOLIO_USDC_ASSET_KEY =
  `eip155:${BASE_CHAIN_ID}/erc20:${PORTFOLIO_USDC_ADDRESS.toLowerCase()}` as const;

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

export type PortfolioErc20Asset = DirectPortfolioAsset & { kind: "erc20"; contractAddress: PortfolioAddress };

export type PortfolioCashAsset = PortfolioErc20Asset & { cashCurrency: FiatCurrencyCode };

function assetIdFor(record: CurrencyRepresentation): string {
  return record.id.replace(/^base:/, "");
}

function currencyPortfolioAsset(record: CurrencyRepresentation, cashCurrency: FiatCurrencyCode | null): PortfolioErc20Asset {
  return {
    id: assetIdFor(record),
    assetKey: assetKeyForErc20(record.contractAddress),
    name: record.name,
    symbol: record.symbol,
    decimals: record.decimals,
    kind: "erc20",
    contractAddress: record.contractAddress,
    cashCurrency,
  };
}

function localCashPortfolioAsset(record: CurrencyRepresentation): PortfolioCashAsset {
  return { ...currencyPortfolioAsset(record, record.displayCurrency), cashCurrency: record.displayCurrency };
}

export const canonicalUsdcAsset: PortfolioErc20Asset = currencyPortfolioAsset(
  usdcRecord, usdcRecord.cash.state === "approved" && usdcRecord.lifecycle === "active" ? usdcRecord.displayCurrency : null,
);

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

export const verifiedLocalCashAssets: Partial<Record<FiatCurrencyCode, PortfolioCashAsset>> = Object.fromEntries(
  approvedCashCurrencies()
    .filter((record) => record.id !== usdcRecordId)
    .map((record) => [record.displayCurrency, localCashPortfolioAsset(record)]),
);

export function verifiedLocalCashAsset(currency: FiatCurrencyCode): PortfolioCashAsset | null {
  const record = approvedCashRecordForCurrency(currency);
  return record && record.id !== usdcRecordId ? verifiedLocalCashAssets[currency] ?? null : null;
}

/** @public Registry projection seam exercised by currency registry tests. */
export function currencyPortfolioAssets(records: readonly CurrencyRepresentation[] = CURRENCY_REGISTRY): PortfolioErc20Asset[] {
  const usdc = records.find((record) => record.id === usdcRecordId);
  if (!usdc) throw new Error("The supported portfolio inventory has no USDC record.");
  return [
    currencyPortfolioAsset(usdc, usdc.cash.state === "approved" && usdc.lifecycle === "active" ? usdc.displayCurrency : null),
    ...approvedCashCurrencies(records)
      .filter((record) => record.id !== usdcRecordId)
      .map((record) => localCashPortfolioAsset(record)),
    ...recordsWithPreservedHoldings(records)
      .filter((record) => record.id !== usdcRecordId)
      .map((record) => currencyPortfolioAsset(record, null)),
  ];
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
    ...currencyPortfolioAssets().filter((asset) => asset.assetKey !== canonicalUsdcAsset.assetKey),
  ];
  assertUniquePortfolioAssets(assets);
  return assets;
}

export function assertUniquePortfolioAssets(assets: readonly { id: string; assetKey: string }[]): void {
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const asset of assets) {
    if (keys.has(asset.assetKey) || ids.has(asset.id)) {
      throw new Error("The supported portfolio inventory contains a duplicate asset.");
    }
    keys.add(asset.assetKey);
    ids.add(asset.id);
  }
}
