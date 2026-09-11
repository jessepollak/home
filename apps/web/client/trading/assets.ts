import {
  BASE_CHAIN_ID,
  investAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";

export const BASE_USDC = {
  id: "usdc",
  symbol: "USDC",
  decimals: 6,
  chainId: BASE_CHAIN_ID,
  contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

export type TradeSide = "buy" | "sell";

export type TradeAsset = InvestAsset & {
  representation: InvestAsset["representation"] & { decimals: number };
};

export type TradeToken = {
  id: string;
  symbol: string;
  decimals: number;
  chainId: typeof BASE_CHAIN_ID;
  contractAddress: `0x${string}`;
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

export function getTradeSellAsset(
  asset: TradeAsset,
  side: TradeSide,
): TradeToken {
  return side === "buy" ? BASE_USDC : toTradeToken(asset);
}

export function getTradeBuyAsset(
  asset: TradeAsset,
  side: TradeSide,
): TradeToken {
  return side === "buy" ? toTradeToken(asset) : BASE_USDC;
}

function toTradeToken(asset: TradeAsset): TradeToken {
  return {
    id: asset.id,
    symbol: asset.representation.tokenSymbol,
    decimals: asset.representation.decimals,
    chainId: asset.chainId,
    contractAddress: asset.contractAddress,
  };
}
