import {
  investAssets,
  initialsFromSymbol,
  type InvestAsset,
} from "@/config/invest-assets";
import { assetKeyForErc20 } from "@/config/portfolio-assets";

export type AssetMarkImageMap = Readonly<Record<string, string | null>>;

export type AssetMarkResolution = {
  images?: AssetMarkImageMap;
  pending?: boolean;
};

export type AssetMarkPresentation = {
  assetKey: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  pending: boolean;
  currency: string | null;
};

type AssetMarkIdentity = {
  assetKey: string;
  name: string;
  symbol: string;
  imageUrl?: string | null;
  currency?: string | null;
};

const investAssetByKey = new Map(
  investAssets.map((asset) => [assetKeyForInvestAsset(asset), asset]),
);

export function assetKeyForInvestAsset(asset: InvestAsset): string {
  return assetKeyForErc20(asset.contractAddress);
}

export function presentInvestAssetMark(
  asset: InvestAsset,
  resolution: AssetMarkResolution = {},
): AssetMarkPresentation {
  return presentAssetMark(
    {
      assetKey: assetKeyForInvestAsset(asset),
      name: asset.displayName,
      symbol: asset.initials,
      currency: null,
    },
    resolution,
  );
}

export function presentPortfolioAssetMark(
  identity: AssetMarkIdentity,
  resolution: AssetMarkResolution = {},
): AssetMarkPresentation {
  const configured = investAssetByKey.get(identity.assetKey);
  return presentAssetMark(
    {
      ...identity,
      name: configured?.displayName ?? identity.name,
      symbol: identity.currency
        ? identity.symbol
        : configured?.initials ??
          (identity.symbol.toUpperCase() === "ETH"
            ? "ETH"
            : initialsFromSymbol(identity.symbol)),
    },
    resolution,
  );
}

function presentAssetMark(
  identity: AssetMarkIdentity,
  resolution: AssetMarkResolution,
): AssetMarkPresentation {
  const resolvedImage =
    normalizedImageUrl(identity.imageUrl) ??
    normalizedImageUrl(resolution.images?.[identity.assetKey]);
  const canResolve =
    investAssetByKey.has(identity.assetKey) ||
    Object.prototype.hasOwnProperty.call(
      resolution.images ?? {},
      identity.assetKey,
    );

  return {
    assetKey: identity.assetKey,
    name: identity.name,
    symbol: identity.symbol,
    imageUrl: resolvedImage,
    pending: Boolean(canResolve && resolution.pending && !resolvedImage),
    currency: identity.currency ?? null,
  };
}

function normalizedImageUrl(imageUrl: string | null | undefined): string | null {
  return imageUrl?.trim() || null;
}
