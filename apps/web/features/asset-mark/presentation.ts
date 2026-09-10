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
  currency?: string | null;
  imageUrl?: string | null;
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
      imageUrl: asset.imageUrl,
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
  const configured = investAssetByKey.get(identity.assetKey);
  const resolvedImage =
    identity.imageUrl?.trim() ||
    (configured ? resolution.images?.[configured.id]?.trim() : null) ||
    null;

  return {
    assetKey: identity.assetKey,
    name: identity.name,
    symbol: identity.symbol,
    imageUrl: resolvedImage,
    pending: Boolean(configured && resolution.pending && !resolvedImage),
    currency: identity.currency ?? null,
  };
}
