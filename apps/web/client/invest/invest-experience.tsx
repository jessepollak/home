"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
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
import { useInvestSearch } from "./use-invest-search";

export type { InvestView };

const investDetailFromStateKey = "investDetailFrom";
const searchQueryKey = "investSearchQuery";
const searchScrollKey = "investSearchScrollTop";

function historySearchState(): { query: string; scrollTop: number } {
  if (typeof window === "undefined") return { query: "", scrollTop: 0 };
  const state: unknown = window.history.state;
  const record = state && typeof state === "object"
    ? state as Record<string, unknown>
    : {};
  return {
    query: typeof record[searchQueryKey] === "string" ? record[searchQueryKey] : "",
    scrollTop: typeof record[searchScrollKey] === "number" ? record[searchScrollKey] : 0,
  };
}

function subscribeToSavedQuery(): () => void {
  return () => {};
}

function readSavedQuery(): string {
  return historySearchState().query;
}

function readServerSavedQuery(): string {
  return "";
}

function saveHistoryQuery(query: string): void {
  if (typeof window === "undefined") return;
  if (historySearchState().query === query) return;
  window.history.replaceState({ ...window.history.state, [searchQueryKey]: query }, "");
}

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
  const [view, setView] = useState<InvestView>(() =>
    routing?.state.location.panel === "invest"
      ? investViewFromLocation(routing.state.location)
      : initialView ?? { screen: "hub" },
  );
  const savedQuery = useSyncExternalStore(subscribeToSavedQuery, readSavedQuery, readServerSavedQuery);
  const [editedQuery, setQuery] = useState<string | null>(null);
  const query = editedQuery ?? savedQuery;
  const [composing, setComposing] = useState(false);
  const search = useInvestSearch(query, composing);
  const detailIdentity = view.screen === "detail"
    ? resolveMarketPriceAssetIdentity(view.assetId)
    : null;
  const knownDetail = view.screen === "detail"
    ? getDiscoverAsset(view.assetId, [
        ...memeAssets,
        ...search.results.map((result) => result.asset),
      ])
    : null;
  const detailQuery = detailIdentity &&
    isDynamicMarketPriceAssetId(detailIdentity.assetId) && !knownDetail
    ? detailIdentity.contractAddress
    : "";
  const detailSearch = useInvestSearch(detailQuery);
  const resolvedDetail = detailSearch.results.find(
    (result) => result.asset.id === detailIdentity?.assetId,
  )?.asset;
  const catalog = [
    ...memeAssets,
    ...search.results.map((result) => result.asset),
    ...(resolvedDetail ? [resolvedDetail] : []),
  ];
  const [inAppChildDepth, setInAppChildDepth] = useState(0);
  const [appliedRootRevision, setAppliedRootRevision] = useState(routing?.rootRequest?.revision ?? 0);
  if (routing?.rootRequest && appliedRootRevision !== routing.rootRequest.revision) {
    setAppliedRootRevision(routing.rootRequest.revision);
    if (routing.rootRequest.panel === "invest") {
      setView({ screen: "hub" });
      setQuery("");
      setInAppChildDepth(0);
    }
  }
  const hostRef = useRef<HTMLDivElement>(null);
  const currentViewKey = viewKey(view);
  const markets = { stockMarket, memeMarket, cryptoMarket };
  const dynamicSnapshots = [
    ...(memeMarket.status === "ready" ? memeMarket.snapshots : []),
    ...search.snapshots,
    ...detailSearch.snapshots,
  ];
  const dynamicDetailMarket: MarketDataState =
    memeMarket.status === "loading" && dynamicSnapshots.length === 0
      ? { status: "loading" }
      : { status: "ready", snapshots: dynamicSnapshots };

  useLayoutEffect(() => {
    if (view.screen === "hub") {
      const scrollTop = historySearchState().scrollTop;
      const host = hostRef.current?.closest("[data-app-main-authenticated]");
      if (host instanceof HTMLElement) host.scrollTop = scrollTop;
      else window.scrollTo(0, scrollTop);
    } else resetHostScroll(hostRef.current);
  }, [currentViewKey, view.screen]);

  const appliedPopRevisionRef = useRef(routing?.popRevision ?? 0);
  useEffect(() => {
    if (!routing || appliedPopRevisionRef.current === routing.popRevision) return;
    appliedPopRevisionRef.current = routing.popRevision;
    if (routing.state.location.panel !== "invest") return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setQuery(historySearchState().query);
      setView((previous) => {
        const next = investViewFromLocation(routing.state.location);
        if (next.screen === "detail") {
          const state: unknown = window.history.state;
          const from = state && typeof state === "object"
            ? (state as Record<string, unknown>)[investDetailFromStateKey]
            : null;
          if (from === "hub") return next;
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
    });
    return () => { active = false; };
  }, [routing]);

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

  const onHubEntry = view.screen === "hub" && (!routing || routing.state.location.panel === "invest");
  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    if (onHubEntry) saveHistoryQuery(next);
  }, [onHubEntry]);

  const savedRootRevisionRef = useRef(appliedRootRevision);
  const rootPanel = routing?.rootRequest?.panel ?? null;
  useEffect(() => {
    if (savedRootRevisionRef.current === appliedRootRevision) return;
    savedRootRevisionRef.current = appliedRootRevision;
    if (rootPanel === "invest") saveHistoryQuery("");
  }, [appliedRootRevision, rootPanel]);

  const go = useCallback((next: InvestView) => {
    const host = hostRef.current?.closest("[data-app-main-authenticated]");
    const scrollTop = host instanceof HTMLElement ? host.scrollTop : window.scrollY;
    window.history.replaceState({ ...window.history.state, [searchQueryKey]: query, [searchScrollKey]: scrollTop }, "");
    setView(next);
    setInAppChildDepth((depth) => depth + 1);
    commitClientUrl(investHref(next), "push", {
      [investDetailFromStateKey]: next.screen === "detail" ? next.from : null,
      [searchQueryKey]: query,
      [searchScrollKey]: scrollTop,
    });
  }, [query]);

  const leaveChild = useCallback((parent: InvestView) => {
    setView(parent);
    if (inAppChildDepth > 0) {
      backClientHistory();
      return;
    }
    commitClientUrl(investHref(parent), "replace", {
      [investDetailFromStateKey]: parent.screen === "detail" ? parent.from : null,
    });
  }, [inAppChildDepth]);

  const detailAsset = view.screen === "detail" ? getDiscoverAsset(view.assetId, catalog) : null;
  const exactAsset = view.screen === "detail" && !detailAsset ? resolveTradeAsset(view.assetId) : null;
  const chromeTitle =
    view.screen === "category"
      ? getDiscoverShelf(view.shelfId)?.title ?? null
      : view.screen === "detail"
        ? detailAsset?.displayName ?? (exactAsset?.status === "tradeable"
          ? `${exactAsset.address.slice(0, 6)}…${exactAsset.address.slice(-4)}` : "Asset details")
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
      memeAssets={memeAssets}
      memeStatus={memeStatus}
      assetMarkResolution={assetMarkResolution}
      query={query}
      onQueryChange={changeQuery}
      composing={composing}
      onComposingChange={setComposing}
      search={search}
      onSeeAll={(shelfId) => go({ screen: "category", shelfId })}
      onOpenAsset={(asset: InvestAsset) =>
        go({ screen: "detail", assetId: asset.id, from: "hub" })
      }
    />
  );

  if (view.screen === "category") {
    const shelf = getDiscoverShelf(view.shelfId);
    if (!shelf) return <div ref={hostRef} />;
    const assets = getShelfAssets(shelf, memeAssets);
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
    } else if (detailQuery && detailSearch.status === "loading") {
      screen = <AssetDetailStatusScreen status="loading" onBack={() => leaveChild(parent)} />;
    } else if (exactAsset?.status === "tradeable" && (!detailQuery || detailSearch.status === "error")) {
      screen = <ExactAddressAssetScreen assetId={view.assetId} onBack={() => leaveChild(parent)} />;
    } else {
      screen = (
        <AssetDetailStatusScreen
          status={!detailQuery && memeStatus === "loading" ? "loading" : "unavailable"}
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
