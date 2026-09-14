import { activityAssets, type ActivityAsset } from "./types";

const unsafeSymbolPattern = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;

export type ActivityTokenMetadata = {
  assetId: ActivityAsset["id"] | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
};

export const activityAssetsByContract = new Map<string, ActivityAsset>(
  activityAssets.map((asset) => [asset.tokenAddress.toLowerCase(), asset]),
);

export const activityRegistrySymbols = new Set(
  activityAssets.map((asset) => asset.symbol.toLowerCase()),
);

export function sanitizeActivityTokenSymbol(value: unknown): string | null {
  if (typeof value !== "string" || unsafeSymbolPattern.test(value)) return null;
  const symbol = value.trim();
  if (
    symbol.length === 0 ||
    symbol.length > 64
  ) {
    return null;
  }
  return symbol;
}

export function sanitizeActivityTokenDecimals(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 255
    ? value as number
    : null;
}

export function sanitizeDynamicActivityTokenMetadata(input: {
  symbol: unknown;
  decimals: unknown;
}): ActivityTokenMetadata {
  const tokenSymbol = sanitizeActivityTokenSymbol(input.symbol);
  const tokenDecimals = sanitizeActivityTokenDecimals(input.decimals);
  if (
    tokenSymbol === null ||
    tokenDecimals === null ||
    activityRegistrySymbols.has(tokenSymbol.toLowerCase())
  ) {
    return { assetId: null, tokenSymbol: null, tokenDecimals: null };
  }
  return { assetId: null, tokenSymbol, tokenDecimals };
}

export function registryActivityTokenMetadata(
  tokenAddress: string,
): ActivityTokenMetadata | null {
  const asset = activityAssetsByContract.get(tokenAddress.toLowerCase());
  return asset
    ? {
        assetId: asset.id,
        tokenSymbol: asset.symbol,
        tokenDecimals: asset.decimals,
      }
    : null;
}
