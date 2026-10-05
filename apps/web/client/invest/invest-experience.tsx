"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNestedAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import { backClientHistory, commitClientUrl } from "@/config/shell-location";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import {
  isDynamicMarketPriceAssetId,
  resolveMarketPriceAssetIdentity,
} from "@/shared/invest/contracts/market-price-history";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import { resolveTradeAsset } from "@/shared/trading/assets";
import { INVEST_SETTINGS_DEFAULTS, type InvestSettings } from "@/shared/operator-settings/invest";
import { browserHomeQueryClient, publicQueryKey, useHomeQueryClient } from "@/client/query/query-client";
import { normalizeInvestSearchQuery, type InvestSearchPage } from "@/shared/invest/contracts/search";
import { isRecord } from "@/shared/guards";
import {
  getDiscoverAsset,
  getDiscoverShelf,
  getShelfAssets,
  hasVisibleShelf,
  marketForAsset,
  type MemePagination,
  type MemeShelfStatus,
} from "./discover";
import {
  AssetDetailScreen,
  AssetDetailStatusScreen,
  ExactAddressAssetScreen,
} from "./asset-detail-screen";
import { CategoryScreen } from "./category-screen";
import { InvestHub } from "./invest-hub";
import {
  investHref,
  investViewFromLocation,
  type InvestView,
} from "./invest-location";
import { resetHostScroll } from "./reset-host-scroll";
import { useResolvedAsset } from "./use-resolved-asset";

export type { InvestView };

const EMPTY_MEME_ASSETS: readonly InvestAsset[] = [];

const investDetailFromStateKey = "investDetailFrom";

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
  investVisibility?: InvestSettings;
};

export function InvestExperience({
  stockMarket = unavailableMarketData,
  memeMarket = unavailableMarketData,
  cryptoMarket = unavailableMarketData,
  initialView,
  memeAssets = EMPTY_MEME_ASSETS,
  memeStatus = "empty",
  assetMarkResolution = {},
  memePagination,
  onLoadMoreMemes,
  onRetryLoadMoreMemes,
  investVisibility = INVEST_SETTINGS_DEFAULTS,
}: InvestExperienceProps = {}) {
  const routing = useOptionalHomeShellRouting();
  const [localView, setView] = useState<InvestView>(() =>
    routing?.state.location.panel === "invest"
      ? investViewFromLocation(routing.state.location)
      : initialView ?? { screen: "hub" },
  );
  const searchDetailOrigin = routing?.getSearchDetailOrigin?.();
  const view = useMemo(() => localView.screen === "detail" && searchDetailOrigin?.assetId === localView.assetId
    ? { ...localView, from: "search" as const } : localView, [localView, searchDetailOrigin]);
  const displayView = view.screen === "category" &&
    !hasVisibleShelf(view.shelfId, memeAssets, investVisibility)
    ? ({ screen: "hub" } as const) : view;
  const [appliedPopRevision, setAppliedPopRevision] = useState(routing?.popRevision ?? 0);
  const [inAppChildDepth, setInAppChildDepth] = useState(0);
  const [appliedRootRevision, setAppliedRootRevision] = useState(routing?.rootRequest?.revision ?? 0);
  if (routing?.rootRequest && appliedRootRevision !== routing.rootRequest.revision) {
    setAppliedRootRevision(routing.rootRequest.revision);
    if (routing.rootRequest.panel === "invest") {
      setView({ screen: "hub" });
      setInAppChildDepth(0);
    }
  }
  if (routing && appliedPopRevision !== routing.popRevision) {
    setAppliedPopRevision(routing.popRevision);
    if (routing.state.location.panel === "invest") {
      setView((previous) => {
        const next = investViewFromLocation(routing.state.location);
        if (next.screen === "detail") {
          const state: unknown = window.history.state;
          const from = state && typeof state === "object"
            ? (state as Record<string, unknown>)[investDetailFromStateKey]
            : null;
          if (from === "hub" || from === "search") return { ...next, from };
          if (typeof from === "string") {
            const shelf = getDiscoverShelf(from);
            if (shelf) return { ...next, from: shelf.id };
          }
          if (previous.screen === "category" && !routing.state.location.shelf) {
            return { ...next, from: previous.shelfId };
          }
        }
        return next;
      });
      setInAppChildDepth((depth) => Math.max(0, depth - 1));
    }
  }
  const routedAsset = routing?.state.location.asset;
  const [appliedAsset, setAppliedAsset] = useState(routedAsset);
  if (appliedAsset !== routedAsset) {
    setAppliedAsset(routedAsset);
    if (routing?.state.location.panel === "invest") setView(investViewFromLocation(routing.state.location));
  }
  useEffect(() => {
    if (view.screen === "detail") routing?.finalizeSearchDetailOrigin?.(view.assetId);
  }, [view, routing]);
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const historyState: unknown = typeof window === "undefined" ? null : window.history.state;
  const detailQuery = view.screen === "detail" && searchDetailOrigin?.assetId === view.assetId
    ? normalizeInvestSearchQuery(searchDetailOrigin.query)
    : isRecord(historyState) && typeof historyState.assetSearchDetailQuery === "string"
      ? normalizeInvestSearchQuery(historyState.assetSearchDetailQuery) : null;
  const cachedSearchPages = view.screen === "detail" && view.from === "search" && detailQuery
    ? queryClient.getQueriesData<{ pages: InvestSearchPage[] }>({ queryKey: publicQueryKey("invest-search", "/api/invest/search", detailQuery) })
      .flatMap(([, data]) => data?.pages ?? []) : [];
  const knownAssets = [...memeAssets, ...cachedSearchPages.flatMap((page) => page.results.map(({ asset }) => asset))];
  const detailIdentity = view.screen === "detail"
    ? resolveMarketPriceAssetIdentity(view.assetId)
    : null;
  const knownDetail = view.screen === "detail"
    ? getDiscoverAsset(view.assetId, knownAssets)
    : null;
  const detailAssetId = detailIdentity &&
    isDynamicMarketPriceAssetId(detailIdentity.assetId) && !knownDetail
    ? detailIdentity.assetId
    : null;
  const detail = useResolvedAsset(detailAssetId);
  const resolvedDetail = detail.asset;
  const catalog = [...knownAssets, ...(resolvedDetail ? [resolvedDetail] : [])];
  const hostRef = useRef<HTMLDivElement>(null);
  const currentViewKey = viewKey(displayView);
  const markets = { stockMarket, memeMarket, cryptoMarket };
  const memeSnapshots = memeMarket.status === "ready" ? memeMarket.snapshots : null;
  const dynamicSnapshots = [
    ...(memeSnapshots ?? []),
    ...cachedSearchPages.flatMap((page) => page.snapshots),
    ...(detail.snapshot ? [detail.snapshot] : []),
  ];
  const dynamicDetailMarket: MarketDataState =
    memeMarket.status === "loading" && dynamicSnapshots.length === 0
      ? { status: "loading" }
      : { status: "ready", snapshots: dynamicSnapshots };

  useLayoutEffect(() => {
    if (displayView.screen !== "hub") resetHostScroll(hostRef.current);
  }, [currentViewKey, displayView.screen]);

  const lastRoutingRef = useRef({ panel: routing?.state.panel ?? null, popRevision: routing?.popRevision ?? 0 });
  useEffect(() => {
    if (!routing) return;
    const lastRouting = lastRoutingRef.current;
    lastRoutingRef.current = { panel: routing.state.panel, popRevision: routing.popRevision };
    if (
      lastRouting.panel === "invest" ||
      routing.state.location.panel !== "invest" ||
      lastRouting.popRevision !== routing.popRevision ||
      routing.state.location.shelf ||
      routing.state.location.asset
    ) return;
    setView({ screen: "hub" });
    setInAppChildDepth(0);
  }, [routing]);


  const go = useCallback((next: InvestView) => {
    setView(next);
    setInAppChildDepth((depth) => depth + 1);
    commitClientUrl(investHref(next), "push", {
      [investDetailFromStateKey]: next.screen === "detail" ? next.from : null,
    });
  }, []);

  const leaveChild = useCallback((parent: InvestView) => {
    if (view.screen === "detail" && view.from === "search") { backClientHistory(); return; }
    setView(parent);
    if (inAppChildDepth > 0) {
      backClientHistory();
      return;
    }
    commitClientUrl(investHref(parent), "replace", {
      [investDetailFromStateKey]: parent.screen === "detail" ? parent.from : null,
    });
  }, [inAppChildDepth, view]);

  const detailAsset = view.screen === "detail" ? getDiscoverAsset(view.assetId, catalog) : null;
  const exactAsset = view.screen === "detail" && !detailAsset ? resolveTradeAsset(view.assetId) : null;
  const chromeTitle =
    displayView.screen === "category"
      ? getDiscoverShelf(displayView.shelfId)?.title ?? null
      : displayView.screen === "detail"
        ? detailAsset?.displayName ?? (exactAsset?.status === "tradeable"
          ? `${exactAsset.address.slice(0, 6)}…${exactAsset.address.slice(-4)}` : "Asset details")
        : null;
  const chromeBackLabel =
    displayView.screen === "category"
      ? "Back to Invest"
      : displayView.screen === "detail"
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
                view.from === "hub" || view.from === "search"
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
      memeAssets={memeAssets}
      memeStatus={memeStatus}
      assetMarkResolution={assetMarkResolution}
      investVisibility={investVisibility}
      onSeeAll={(shelfId) => go({ screen: "category", shelfId })}
      onOpenAsset={(asset: InvestAsset) =>
        go({ screen: "detail", assetId: asset.id, from: "hub" })
      }
    />
  );

  if (displayView.screen === "category") {
    const shelf = getDiscoverShelf(displayView.shelfId);
    if (!shelf) return <div ref={hostRef} />;
    const assets = getShelfAssets(shelf, memeAssets, investVisibility);
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
      view.from === "hub" || view.from === "search"
        ? ({ screen: "hub" } as const)
        : ({ screen: "category", shelfId: view.from } as const);
    if (detailAsset) {
      screen = (
        <AssetDetailScreen
          asset={detailAsset}
          market={
            detailIdentity && isDynamicMarketPriceAssetId(detailIdentity.assetId)
              ? dynamicDetailMarket
              : marketForAsset(detailAsset, markets)
          }
          assetMarkResolution={assetMarkResolution}
          onBack={() => leaveChild(parent)}
        />
      );
    } else if (detailAssetId && detail.status === "loading") {
      screen = <AssetDetailStatusScreen status="loading" onBack={() => leaveChild(parent)} />;
    } else if (exactAsset?.status === "tradeable" && (!detailAssetId || detail.status === "error")) {
      screen = <ExactAddressAssetScreen assetId={view.assetId} onBack={() => leaveChild(parent)} />;
    } else {
      screen = (
        <AssetDetailStatusScreen
          status={!detailAssetId && memeStatus === "loading" ? "loading" : "unavailable"}
          onBack={() => leaveChild(parent)}
        />
      );
    }
  }

  return (
    <div ref={hostRef}>
      <div key={currentViewKey}>
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
