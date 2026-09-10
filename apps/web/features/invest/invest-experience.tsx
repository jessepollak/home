"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useNestedAppChrome, type NestedAppChrome } from "@/components/app-chrome";
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

  const go = useCallback((next: InvestView) => {
    setView(next);
    setInAppChildDepth((depth) => depth + 1);
    router.push(investHref(next), { scroll: false });
  }, [router]);

  const leaveChild = useCallback((parent: InvestView) => {
    setView(parent);
    if (inAppChildDepth > 0) {
      router.back();
      return;
    }
    router.replace(investHref(parent), { scroll: false });
  }, [inAppChildDepth, router]);

  const detailTitle =
    view.screen === "detail"
      ? getDiscoverAsset(view.assetId, catalog)?.displayName ?? "Asset details"
      : null;
  const nestedChrome = useMemo<NestedAppChrome | null>(() => {
    if (view.screen === "category") {
      const shelf = getDiscoverShelf(view.shelfId);
      if (!shelf) return null;
      return {
        title: shelf.title,
        onBack: () => leaveChild({ screen: "hub" }),
        backLabel: "Back to Invest",
      };
    }
    if (view.screen === "detail") {
      const parent =
        view.from === "hub"
          ? ({ screen: "hub" } as const)
          : ({ screen: "category", shelfId: view.from } as const);
      return {
        title: detailTitle ?? "Asset details",
        onBack: () => leaveChild(parent),
        backLabel: "Back",
      };
    }
    return null;
  }, [detailTitle, leaveChild, view]);

  useNestedAppChrome(nestedChrome);

  if (view.screen === "category") {
    const shelf = getDiscoverShelf(view.shelfId);
    if (!shelf) return null;
    const assets = getShelfAssets(shelf, catalog).map((asset) =>
      applyAssetIcon(asset, assetIcons),
    );
    return (
      <div className="panel-fade">
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
      </div>
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
        <div className="panel-fade">
          <AssetDetailStatusScreen
            status={memeStatus === "loading" ? "loading" : "unavailable"}
            onBack={() => leaveChild(parent)}
          />
        </div>
      );
    }
    const marked = applyAssetIcon(asset, assetIcons);
    return (
      <div className="panel-fade">
        <AssetDetailScreen
          asset={marked}
          market={marketForAsset(marked, markets)}
          iconPending={iconsPending}
          onBack={() => leaveChild(parent)}
        />
      </div>
    );
  }

  return (
    <div className="panel-fade">
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
    </div>
  );
}
