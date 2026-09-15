"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNestedAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import { commitClientUrl } from "@/config/shell-location";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import {
  getDiscoverAsset,
  getDiscoverShelf,
  getShelfAssets,
  marketForAsset,
  type MemePagination,
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
  investViewFromLocation,
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
  memePagination?: MemePagination;
  onLoadMoreMemes?: () => void;
  onRetryLoadMoreMemes?: () => void;
};

export function InvestExperience({
  stockMarket = unavailableMarketData,
  memeMarket = unavailableMarketData,
  cryptoMarket = unavailableMarketData,
  initialView,
  memeAssets = [],
  memeStatus = "empty",
  assetMarkResolution = {},
  memePagination,
  onLoadMoreMemes,
  onRetryLoadMoreMemes,
}: InvestExperienceProps = {}) {
  const routing = useOptionalHomeShellRouting();
  // initialView comes from the server-supplied dashboard query, so SSR and the
  // first hydrated render agree on hub/category/detail. Reading window.location
  // here made the client diverge from the server HTML (hydration mismatch) and
  // let a stale URL override the server-selected view (#460). Later URL changes
  // are applied by the routing pop effect below.
  const [view, setView] = useState<InvestView>(() => initialView ?? { screen: "hub" });
  const [inAppChildDepth, setInAppChildDepth] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const currentViewKey = viewKey(view);
  const markets = { stockMarket, memeMarket, cryptoMarket };
  const catalog = memeAssets;

  useLayoutEffect(() => {
    resetHostScroll(hostRef.current);
  }, [currentViewKey]);

  const appliedPopRevisionRef = useRef(routing?.popRevision ?? 0);
  useEffect(() => {
    if (!routing || appliedPopRevisionRef.current === routing.popRevision) return;
    appliedPopRevisionRef.current = routing.popRevision;
    if (routing.state.location.panel !== "invest") return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setView((previous) => {
        const next = investViewFromLocation(routing.state.location);
        // History carries only the flat asset path, so a Forward into a detail
        // restores the category context of the immediately preceding view; a
        // cold flat reload has none and returns to /invest.
        if (next.screen === "detail" && previous.screen === "category" && !routing.state.location.shelf) {
          return { ...next, from: previous.shelfId };
        }
        return next;
      });
      setInAppChildDepth((depth) => Math.max(0, depth - 1));
    });
    return () => { active = false; };
  }, [routing]);

  const go = useCallback((next: InvestView) => {
    setView(next);
    setInAppChildDepth((depth) => depth + 1);
    commitClientUrl(investHref(next));
  }, []);

  const leaveChild = useCallback((parent: InvestView) => {
    setView(parent);
    if (inAppChildDepth > 0) {
      window.history.back();
      return;
    }
    commitClientUrl(investHref(parent), "replace");
  }, [inAppChildDepth]);

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
    (!routing || routing.state.panel === "invest") && chromeTitle && chromeBackLabel
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
        pagination={shelf.id === "memes" ? memePagination : undefined}
        onLoadMore={shelf.id === "memes" ? onLoadMoreMemes : undefined}
        onRetryLoadMore={shelf.id === "memes" ? onRetryLoadMoreMemes : undefined}
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
