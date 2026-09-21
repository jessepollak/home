import "server-only";

import {
  getDirectPortfolioAssets,
  portfolioVaults,
  PORTFOLIO_USDC_ASSET_KEY,
} from "@/config/portfolio-assets";
import {
  erc20AssetKey,
  nativeAssetKey,
} from "@/shared/balances/types";
import type { BalancesUniverse, UniverseEntry } from "./types";

export function registryEntries(): UniverseEntry[] {
  const direct = getDirectPortfolioAssets();
  const cash = direct.filter((asset) => asset.cashCurrency !== null);
  const native = direct.filter((asset) => asset.kind === "native");
  const other = direct.filter(
    (asset) => asset.cashCurrency === null && asset.kind !== "native",
  );

  return [
    ...cash,
    ...native,
    ...other,
  ].map((asset): UniverseEntry => ({
    key:
      asset.kind === "native"
        ? nativeAssetKey()
        : erc20AssetKey(asset.contractAddress!),
    kind: asset.kind,
    source: "registry",
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    contractAddress: asset.contractAddress
      ? asset.contractAddress.toLowerCase() as `0x${string}`
      : null,
    cashCurrency: asset.cashCurrency,
  })).concat(portfolioVaults.map((vault): UniverseEntry => ({
    key: erc20AssetKey(vault.address),
    kind: "vault-share",
    source: "registry",
    id: vault.id,
    name: vault.name,
    symbol: vault.symbol,
    decimals: vault.decimals,
    contractAddress: vault.address.toLowerCase() as `0x${string}`,
    cashCurrency: null,
    underlying: {
      key: PORTFOLIO_USDC_ASSET_KEY,
      symbol: "USDC",
      decimals: 6,
    },
  })));
}

export async function getBalancesUniverse(): Promise<BalancesUniverse> {
  return { entries: registryEntries() };
}
