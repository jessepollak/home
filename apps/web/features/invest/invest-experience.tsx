"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InvestAsset } from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import {
  applyAssetIcon,
  getDiscoverAsset,
  getDiscoverShelf,
  getShelfAssets,
  marketForAsset,
  type MemeShelfStatus,
} from "./discover";
import {
  AssetDetailScreen,
  AssetDetailStatusScreen,
} from "./asset-detail-screen";
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
  memeAssets?: readonly InvestAsset[];
  memeStatus?: MemeShelfStatus;
  assetIcons?: Readonly<Record<string, string | null>>;
  iconsPending?: boolean;
};

export function InvestExperience({
  stockMarket = unavailableMarketData,
  memeMarket = unavailableMarketData,
  cryptoMarket = unavailableMarketData,
  initialView,
  memeAssets = [],
  memeStatus = "empty",
  assetIcons = {},
  iconsPending = false,
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
  const [inAppChildDepth, setInAppChildDepth] = useState(0);
  const markets = { stockMarket, memeMarket, cryptoMarket };
  const catalog = memeAssets.map((asset) => applyAssetIcon(asset, assetIcons));

  useEffect(() => {
    const onPopState = () => {
      setView(investViewFromSearch(new URLSearchParams(window.location.search)));
      setInAppChildDepth((depth) => Math.max(0, depth - 1));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function go(next: InvestView) {
    setView(next);
    setInAppChildDepth((depth) => depth + 1);
    router.push(investHref(next), { scroll: false });
  }

  function leaveChild(parent: InvestView) {
    setView(parent);
    if (inAppChildDepth > 0) {
      router.back();
      return;
    }
    router.replace(investHref(parent), { scroll: false });
  }

  if (view.screen === "category") {
    const shelf = getDiscoverShelf(view.shelfId);
    if (!shelf) return null;
    const assets = getShelfAssets(shelf, catalog).map((asset) =>
      applyAssetIcon(asset, assetIcons),
    );
    return (
      <CategoryScreen
        title={shelf.title}
        shelfId={shelf.id}
        assets={assets}
        market={
          shelf.category === "meme"
            ? memeMarket
            : assets[0]
              ? marketForAsset(assets[0], markets)
              : unavailableMarketData
        }
        status={shelf.id === "memes" ? memeStatus : "ready"}
        iconsPending={iconsPending}
        onBack={() => leaveChild({ screen: "hub" })}
        onOpenAsset={(asset, from) =>
          go({ screen: "detail", assetId: asset.id, from })
        }
      />
    );
  }

  if (view.screen === "detail") {
    const parent =
      view.from === "hub"
        ? ({ screen: "hub" } as const)
        : ({ screen: "category", shelfId: view.from } as const);
    const asset = getDiscoverAsset(view.assetId, catalog);
    if (!asset) {
      return (
        <AssetDetailStatusScreen
          status={memeStatus === "loading" ? "loading" : "unavailable"}
          onBack={() => leaveChild(parent)}
        />
      );
    }
    const marked = applyAssetIcon(asset, assetIcons);
    return (
      <AssetDetailScreen
        asset={marked}
        market={marketForAsset(marked, markets)}
        iconPending={iconsPending}
        onBack={() => leaveChild(parent)}
      />
    );
  }

  return (
    <InvestHub
      stockMarket={stockMarket}
      memeMarket={memeMarket}
      cryptoMarket={cryptoMarket}
      memeAssets={catalog}
      memeStatus={memeStatus}
      assetIcons={assetIcons}
      iconsPending={iconsPending}
      onSeeAll={(shelfId) => go({ screen: "category", shelfId })}
      onOpenAsset={(asset: InvestAsset) =>
        go({ screen: "detail", assetId: asset.id, from: "hub" })
      }
    />
  );
}
