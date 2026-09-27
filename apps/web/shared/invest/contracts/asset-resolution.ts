import { investAssets, type InvestAsset } from "@/config/invest-assets";
import type { MarketSnapshot } from "@/shared/invest/invest-market";
import { parseDynamicInvestAsset } from "./discover";
import { resolveMarketPriceAssetIdentity } from "./market-price-history";

export const ASSET_RESOLUTION_VERSION = 1 as const;
export type AssetResolutionResponse = {
  version: typeof ASSET_RESOLUTION_VERSION;
  assetId: string;
  asset: InvestAsset | null;
  source: "configured" | "indexed" | "onchain" | null;
  snapshot: MarketSnapshot | null;
  provider: "ok" | "skipped" | "unavailable" | "error";
};

export function parseAssetResolutionRequest(params: URLSearchParams): string | null {
  const assetId = params.get("assetId");
  return assetId && resolveMarketPriceAssetIdentity(assetId) ? assetId : null;
}

export function parseAssetResolutionResponse(value: unknown): AssetResolutionResponse | null {
  const record = readRecord(value);
  if (!record || record.version !== ASSET_RESOLUTION_VERSION || typeof record.assetId !== "string" ||
      !resolveMarketPriceAssetIdentity(record.assetId) ||
      !["ok", "skipped", "unavailable", "error"].includes(String(record.provider))) return null;
  const provider = record.provider as AssetResolutionResponse["provider"];
  if (record.asset === null) return record.source === null && record.snapshot === null
    ? { version: ASSET_RESOLUTION_VERSION, assetId: record.assetId, asset: null, source: null, snapshot: null, provider } : null;
  const configured = investAssets.find((asset) => asset.id === record.assetId);
  const asset = record.source === "configured" ? configured : parseDynamicInvestAsset(record.asset);
  if (!asset || asset.id !== record.assetId ||
      (record.source !== "configured" && record.source !== "indexed" && record.source !== "onchain")) return null;
  const snapshot = record.snapshot === null ? null : parseAssetSnapshot(record.snapshot);
  if (record.snapshot !== null && (!snapshot || snapshot.assetId !== asset.id || record.source !== "indexed")) return null;
  return { version: ASSET_RESOLUTION_VERSION, assetId: asset.id, asset, source: record.source, snapshot, provider };
}

export function parseAssetSnapshot(value: unknown): MarketSnapshot | null {
  const snapshot = readRecord(value);
  if (
    !snapshot ||
    typeof snapshot.assetId !== "string" ||
    typeof snapshot.displayPrice !== "string" ||
    snapshot.displayPrice.length === 0 ||
    typeof snapshot.asOf !== "string" ||
    typeof snapshot.sourceLabel !== "string"
  ) {
    return null;
  }
  return {
    assetId: snapshot.assetId,
    displayPrice: snapshot.displayPrice,
    asOf: snapshot.asOf,
    sourceLabel: snapshot.sourceLabel,
    ...(typeof snapshot.sourceUrl === "string" ? { sourceUrl: snapshot.sourceUrl } : {}),
    ...(typeof snapshot.changeLabel === "string"
      ? { changeLabel: snapshot.changeLabel }
      : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
