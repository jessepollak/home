import {

  investAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";

export type TradeAsset = InvestAsset & {
  representation: InvestAsset["representation"] & { decimals: number };
};

export type TradeAssetStatus =
  | { status: "tradeable"; asset: TradeAsset }
  | { status: "eligibility-required"; asset: InvestAsset };

const assetById = new Map<InvestAssetId, InvestAsset>(
  investAssets.map((asset) => [asset.id, asset]),
);

export function getTradeAssetStatus(assetId: string): TradeAssetStatus | null {
  const asset = assetById.get(assetId as InvestAssetId);
  if (!asset) return null;
  if (asset.category === "stock") {
    return { status: "eligibility-required", asset };
  }
  if (!Number.isInteger(asset.representation.decimals)) return null;
  return { status: "tradeable", asset: asset as TradeAsset };
}
