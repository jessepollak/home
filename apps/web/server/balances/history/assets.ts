import "server-only";

import { portfolioVaults } from "@/config/portfolio-assets";
import type { FiatCurrencyCode } from "@/config/regions";
import { stockAssets } from "@/config/invest-assets";
import { erc20AssetKey, nativeAssetKey } from "@/shared/balances/types";
import type { HexAddress, HexHash, HistoryAsset, TransferLoggedAsset } from "./types";

export const HISTORY_WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as const;

const B20_PREFIX = "0xb20000000000000000000";
const vaultAddresses = new Set(portfolioVaults.map((vault) => vault.address.toLowerCase()));
const staticArchiveRead = new Set<string>([
  HISTORY_WETH_ADDRESS,
  ...stockAssets.map((asset) => asset.contractAddress.toLowerCase()),
]);

export function nativeHistoryAsset(): Extract<HistoryAsset, { kind: "native" }> {
  return { key: nativeAssetKey(), kind: "native", contractAddress: null, marketId: null };
}

export function contractHistoryAsset(contract: string, prior?: { kind?: HistoryAsset["kind"]; decimals?: number; cashCurrency?: FiatCurrencyCode | null }): TransferLoggedAsset {
  const address = contract.toLowerCase() as HexAddress;
  return {
    key: erc20AssetKey(address),
    kind: vaultAddresses.has(address) || prior?.kind === "vault-share" ? "vault-share" : "erc20",
    contractAddress: address,
    marketId: null,
    ...(prior?.decimals !== undefined ? { decimals: prior.decimals } : {}),
    ...(prior?.cashCurrency !== undefined ? { cashCurrency: prior.cashCurrency } : {}),
  };
}

type MorphoHistoryAsset = Extract<HistoryAsset, { marketId: HexHash }>;

export function morphoHistoryAssets(marketId: string): [MorphoHistoryAsset, MorphoHistoryAsset] {
  const id = marketId.toLowerCase() as HexHash;
  return [
    { key: `morpho:${id}:collateral`, kind: "morpho-collateral", contractAddress: null, marketId: id },
    { key: `morpho:${id}:borrow-shares`, kind: "morpho-borrow-shares", contractAddress: null, marketId: id },
  ];
}

export function isStaticArchiveRead(asset: HistoryAsset): boolean {
  if (asset.contractAddress === null) return false;
  return staticArchiveRead.has(asset.contractAddress) || asset.contractAddress.startsWith(B20_PREFIX);
}
