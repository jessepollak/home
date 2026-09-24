import { getDirectPortfolioAssets } from "@/config/portfolio-assets";
import { activityAssets, type ActivityAsset } from "./types";

const unsafeSymbolPattern = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const symbolPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const urlLikeSymbolPattern = /www|http|\.[a-z]{2,}/i;
const addressLikeSymbolPattern = /^0x[0-9a-f]{8,}/i;

function activitySymbolSkeleton(symbol: string): string {
  return symbol.toLowerCase()
    .replace(/[\s._+-]/g, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1i]/g, "l")
    .replace(/5/g, "s")
    .replace(/8/g, "b");
}

const reviewedActivitySymbolSkeletons = new Set(
  [
    ...activityAssets.map((asset) => asset.symbol),
    ...getDirectPortfolioAssets()
      .filter((asset) => asset.kind === "native")
      .map((asset) => asset.symbol),
  ].map(activitySymbolSkeleton),
);

export type ActivityTokenMetadata = {
  assetId: ActivityAsset["id"] | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  tokenImageUrl: string | null;
};

export const ACTIVITY_PROVIDER_IMAGE_HOSTS = ["token-media.defined.fi", "media.thegrid.id"] as const;

export function sanitizeActivityTokenImageUrl(
  value: unknown,
  source: "registry" | "dynamic",
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (source === "dynamic" && !ACTIVITY_PROVIDER_IMAGE_HOSTS.some((host) => host === url.hostname))
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const activityAssetsByContract = new Map<string, ActivityAsset>(
  activityAssets.map((asset) => [asset.tokenAddress.toLowerCase(), asset]),
);

export function sanitizeActivityTokenSymbol(value: unknown): string | null {
  if (typeof value !== "string" || unsafeSymbolPattern.test(value)) return null;
  const symbol = value.trim();
  if (
    symbol.length > 16 ||
    !symbolPattern.test(symbol) ||
    urlLikeSymbolPattern.test(symbol) ||
    addressLikeSymbolPattern.test(symbol)
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
    reviewedActivitySymbolSkeletons.has(activitySymbolSkeleton(tokenSymbol))
  ) {
    return { assetId: null, tokenSymbol: null, tokenDecimals: null, tokenImageUrl: null };
  }
  return { assetId: null, tokenSymbol, tokenDecimals, tokenImageUrl: null };
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
        tokenImageUrl: null,
      }
    : null;
}
