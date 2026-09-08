"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InvestAsset } from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import {
  getDiscoverAsset,
  getDiscoverShelf,
  marketForAsset,
} from "./discover";
import { AssetDetailScreen } from "./asset-detail-screen";
import { CategoryScreen } from "./category-screen";
import { InvestHub } from "./invest-hub";
import {
  investHref,
  investViewFromSearch,
  type InvestView,
} from "./invest-location";

export type { InvestView };

export type InvestExperienceProps = {
  stockMarket?: MarketDataState;
  memeMarket?: MarketDataState;
  cryptoMarket?: MarketDataState;
  initialView?: InvestView;
};

export function InvestExperience({
  stockMarket = unavailableMarketData,
  memeMarket = unavailableMarketData,
  cryptoMarket = unavailableMarketData,
  initialView,
}: InvestExperienceProps = {}) {
  const router = useRouter();
  const [view, setView] = useState<InvestView>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = investViewFromSearch(
        new URLSearchParams(window.location.search),
      );
      if (fromUrl.screen !== "hub") return fromUrl;
    }
    return initialView ?? { screen: "hub" };
  });
  const markets = { stockMarket, memeMarket, cryptoMarket };

  useEffect(() => {
    const onPopState = () => {
      setView(investViewFromSearch(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function go(next: InvestView, history: "push" | "replace") {
    setView(next);
    const href = investHref(next);
    if (history === "push") router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }

  if (view.screen === "category") {
    const shelf = getDiscoverShelf(view.shelfId);
    if (!shelf) return null;
    return (
      <CategoryScreen
        title={shelf.title}
        shelfId={shelf.id}
        assets={shelf.assets}
        market={marketForAsset(shelf.assets[0], markets)}
        onBack={() => go({ screen: "hub" }, "replace")}
        onOpenAsset={(asset, from) =>
          go({ screen: "detail", assetId: asset.id, from }, "push")
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
          go(
            view.from === "hub"
              ? { screen: "hub" }
              : { screen: "category", shelfId: view.from },
            "replace",
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
      onSeeAll={(shelfId) => go({ screen: "category", shelfId }, "push")}
      onOpenAsset={(asset: InvestAsset) =>
        go({ screen: "detail", assetId: asset.id, from: "hub" }, "push")
      }
    />
  );
}
