"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNestedAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/features/asset-mark/presentation";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import {
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
import { resetHostScroll } from "./reset-host-scroll";

export type { InvestView };

export type InvestExperienceProps = {
  stockMarket?: MarketDataState;
  memeMarket?: MarketDataState;
  cryptoMarket?: MarketDataState;
  initialView?: InvestView;
  memeAssets?: readonly InvestAsset[];
  memeStatus?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
};

export function InvestExperience({
  stockMarket = unavailableMarketData,
  memeMarket = unavailableMarketData,
  cryptoMarket = unavailableMarketData,
  initialView,
  memeAssets = [],
  memeStatus = "empty",
  assetMarkResolution = {},
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
  const hostRef = useRef<HTMLDivElement>(null);
  const currentViewKey = viewKey(view);
  const markets = { stockMarket, memeMarket, cryptoMarket };
  const catalog = memeAssets;

  useLayoutEffect(() => {
    resetHostScroll(hostRef.current);
  }, [currentViewKey]);

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

  const chromeTitle =
    view.screen === "category"
      ? getDiscoverShelf(view.shelfId)?.title ?? null
      : view.screen === "detail"
        ? getDiscoverAsset(view.assetId, catalog)?.displayName ?? "Asset details"
        : null;
  const chromeBackLabel =
    view.screen === "category"
      ? "Back to Invest"
      : view.screen === "detail"
        ? "Back"
        : null;

  useNestedAppChrome(
    chromeTitle && chromeBackLabel
      ? {
          title: chromeTitle,
          backLabel: chromeBackLabel,
          onBack: () => {
            if (view.screen === "category") {
              leaveChild({ screen: "hub" });
              return;
            }
            if (view.screen === "detail") {
              leaveChild(
                view.from === "hub"
                  ? { screen: "hub" }
                  : { screen: "category", shelfId: view.from },
              );
            }
          },
        }
      : null,
  );

  let screen = (
    <InvestHub
      stockMarket={stockMarket}
      memeMarket={memeMarket}
      cryptoMarket={cryptoMarket}
      memeAssets={catalog}
      memeStatus={memeStatus}
      assetMarkResolution={assetMarkResolution}
      onSeeAll={(shelfId) => go({ screen: "category", shelfId })}
      onOpenAsset={(asset: InvestAsset) =>
        go({ screen: "detail", assetId: asset.id, from: "hub" })
      }
    />
  );

  if (view.screen === "category") {
    const shelf = getDiscoverShelf(view.shelfId);
    if (!shelf) return <div ref={hostRef} />;
    const assets = getShelfAssets(shelf, catalog);
    screen = (
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
        assetMarkResolution={assetMarkResolution}
        onBack={() => leaveChild({ screen: "hub" })}
        onOpenAsset={(asset, from) =>
          go({ screen: "detail", assetId: asset.id, from })
        }
      />
    );
  } else if (view.screen === "detail") {
    const parent =
      view.from === "hub"
        ? ({ screen: "hub" } as const)
        : ({ screen: "category", shelfId: view.from } as const);
    const asset = getDiscoverAsset(view.assetId, catalog);
    if (!asset) {
      screen = (
        <AssetDetailStatusScreen
          status={memeStatus === "loading" ? "loading" : "unavailable"}
          onBack={() => leaveChild(parent)}
        />
      );
    } else {
      screen = (
        <AssetDetailScreen
          asset={asset}
          market={marketForAsset(asset, markets)}
          assetMarkResolution={assetMarkResolution}
          onBack={() => leaveChild(parent)}
        />
      );
    }
  }

  return (
    <div ref={hostRef}>
      <div className="panel-fade" key={currentViewKey}>
        {screen}
      </div>
    </div>
  );
}

function viewKey(view: InvestView): string {
  if (view.screen === "hub") return "hub";
  if (view.screen === "category") return `category:${view.shelfId}`;
  return `detail:${view.from}:${view.assetId}`;
}
