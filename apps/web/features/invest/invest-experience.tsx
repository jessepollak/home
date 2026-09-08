"use client";

import { useState } from "react";
import type { InvestAsset } from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import {
  getDiscoverAsset,
  getDiscoverShelf,
  marketForAsset,
  type DiscoverShelfId,
} from "./discover";
import { AssetDetailScreen } from "./asset-detail-screen";
import { CategoryScreen } from "./category-screen";
import { InvestHub } from "./invest-hub";

export type InvestExperienceProps = {
  stockMarket?: MarketDataState;
  memeMarket?: MarketDataState;
  cryptoMarket?: MarketDataState;
};

type InvestView =
  | { screen: "hub" }
  | { screen: "category"; shelfId: DiscoverShelfId }
  | { screen: "detail"; assetId: string; from: "hub" | DiscoverShelfId };

export function InvestExperience({
  stockMarket = unavailableMarketData,
  memeMarket = unavailableMarketData,
  cryptoMarket = unavailableMarketData,
}: InvestExperienceProps = {}) {
  const [view, setView] = useState<InvestView>({ screen: "hub" });
  const markets = { stockMarket, memeMarket, cryptoMarket };

  if (view.screen === "category") {
    const shelf = getDiscoverShelf(view.shelfId);
    if (!shelf) return null;
    return (
      <CategoryScreen
        title={shelf.title}
        shelfId={shelf.id}
        assets={shelf.assets}
        market={marketForAsset(shelf.assets[0], markets)}
        onBack={() => setView({ screen: "hub" })}
        onOpenAsset={(asset, from) =>
          setView({ screen: "detail", assetId: asset.id, from })
        }
      />
    );
  }

  if (view.screen === "detail") {
    const asset = getDiscoverAsset(view.assetId);
    if (!asset) return null;
    return (
      <AssetDetailScreen
        asset={asset}
        market={marketForAsset(asset, markets)}
        onBack={() =>
          setView(
            view.from === "hub"
              ? { screen: "hub" }
              : { screen: "category", shelfId: view.from },
          )
        }
      />
    );
  }

  return (
    <InvestHub
      stockMarket={stockMarket}
      memeMarket={memeMarket}
      cryptoMarket={cryptoMarket}
      onSeeAll={(shelfId) => setView({ screen: "category", shelfId })}
      onOpenAsset={(asset: InvestAsset) =>
        setView({ screen: "detail", assetId: asset.id, from: "hub" })
      }
    />
  );
}
