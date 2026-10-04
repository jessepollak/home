"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsPresent } from "motion/react";
import { useShellViewportGeometry } from "@/components/visual-viewport";
import { ShellSearchControl, ShellSearchField } from "@/components/shell-search-controls";
import { ShellSearchBar, ShellSearchSurface } from "@/components/ui/shell-search-surface";
import { shellFrameClassName } from "@/components/shell-layout";
import type { ShellSearchContentProps } from "@/client/home/home-types";
import { INVEST_SEARCH_QUERY_MAX_LENGTH, normalizeInvestSearchQuery } from "@/shared/invest/contracts/search";
import { INVEST_SETTINGS_DEFAULTS, isInvestAssetVisible, type InvestSettings } from "@/shared/operator-settings/invest";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { AssetSearchResults } from "./asset-search-results";
import { useInvestSearch } from "./use-invest-search";
import { useMarketPrices } from "./use-market-prices";
import { PresentationQuoteProvider, presentationQuoteForRegion, usePresentationRegionId } from "./presentation-quote";
import type { UseInvestDiscoverResult } from "./use-invest-discover";
import styles from "@/components/primary-navigation.module.css";

export function PricedAssetSearch({ discover, investVisibility, ...props }: ShellSearchContentProps & {
  discover: UseInvestDiscoverResult;
  investVisibility?: InvestSettings;
}) {
  const { fx, stockMarket, cryptoMarket = unavailableMarketData } = useMarketPrices();
  const regionId = usePresentationRegionId("US");
  const quote = useMemo(() => presentationQuoteForRegion(regionId, fx), [regionId, fx]);
  return <PresentationQuoteProvider value={quote}><AssetSearch {...props} investVisibility={investVisibility}
    markets={{ stockMarket, cryptoMarket, memeMarket: discover.memeMarket }} assetMarkResolution={discover.assetMarkResolution} /></PresentationQuoteProvider>;
}

export function AssetSearch({ initialQuery, initialScrollTop = 0, initialResultId = null, onInputReady, onClose, onQueryCommit, onOpenAsset,
  investVisibility = INVEST_SETTINGS_DEFAULTS, markets = { stockMarket: unavailableMarketData, cryptoMarket: unavailableMarketData, memeMarket: unavailableMarketData },
  assetMarkResolution = {},
}: ShellSearchContentProps & {
  investVisibility?: InvestSettings;
  markets?: { stockMarket: MarketDataState; cryptoMarket: MarketDataState; memeMarket: MarketDataState };
  assetMarkResolution?: AssetMarkResolution;
}) {
  const present = useIsPresent();
  useShellViewportGeometry(present);
  const wasPresentRef = useRef(present);
  const [entryVersion, setEntryVersion] = useState(0);
  const entryVersionRef = useRef(entryVersion);
  const [query, setQuery] = useState(initialQuery);
  const [composing, setComposing] = useState(false);
  const search = useInvestSearch(query, composing);
  const results = useMemo(() => search.results.filter(({ asset }) => isInvestAssetVisible(investVisibility, asset)), [search.results, investVisibility]);
  const surfaceRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<{ scrollTop: number; assetId: string | null } | null>({ scrollTop: initialScrollTop, assetId: initialResultId });
  useLayoutEffect(() => {
    if (!present && surfaceRef.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (present && !wasPresentRef.current) {
      entryVersionRef.current += 1;
      setEntryVersion(entryVersionRef.current);
      setQuery(initialQuery);
      setComposing(false);
      restoreRef.current = { scrollTop: initialScrollTop, assetId: initialResultId };
      if (scrollRef.current) scrollRef.current.scrollTop = initialScrollTop;
    }
    wasPresentRef.current = present;
  }, [present, initialQuery, initialScrollTop, initialResultId]);
  useLayoutEffect(() => {
    surfaceRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (present && entryVersion === entryVersionRef.current && !composing && normalizeInvestSearchQuery(query) === search.activeQuery) onQueryCommit(search.activeQuery);
  }, [present, entryVersion, query, composing, search.activeQuery, onQueryCommit]);
  useLayoutEffect(() => {
    if (!present || entryVersion !== entryVersionRef.current) return;
    const saved = restoreRef.current;
    const restorable = search.status === "ready" || (search.status === "error" && results.length > 0);
    if (!saved || !restorable) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = Math.min(Math.max(0, saved.scrollTop), Math.max(0, scroll.scrollHeight - scroll.clientHeight));
    const row = saved.assetId ? surfaceRef.current?.querySelector<HTMLElement>(`[data-search-asset-id="${CSS.escape(saved.assetId)}"]`) : null;
    if (saved.assetId) (row ?? scroll).focus({ preventScroll: true });
    restoreRef.current = null;
  }, [present, entryVersion, search.status, results]);
  return <ShellSearchSurface id="asset-search-surface" ref={surfaceRef}
    className={styles.assetSearchSurface}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !composing && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')].filter((node) => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest('[inert], [hidden]') && node.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      const active = document.activeElement;
      const nonTabbableInside = event.currentTarget.contains(active) && !controls.some((node) => node === active);
      if (!first || !last) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }
      else if (event.shiftKey && (active === first || nonTabbableInside)) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (active === last || nonTabbableInside)) { event.preventDefault(); first.focus({ preventScroll: true }); }
    }}>
    <div ref={scrollRef} hidden={!present} tabIndex={-1} data-asset-search-scroll="" className={`${styles.assetSearchResults} relative min-h-0 flex-1 overflow-y-auto overscroll-contain`}
      onScroll={() => { if (restoreRef.current) restoreRef.current = null; }}>
      <div className={`${shellFrameClassName} py-4 sm:py-6`}><AssetSearchResults query={query} composing={composing} search={{ ...search, results }}
        markets={markets} assetMarkResolution={assetMarkResolution} onOpenAsset={(asset) => onOpenAsset(asset.id, query, scrollRef.current?.scrollTop ?? 0)} /></div>
    </div>
    <ShellSearchBar>
      <ShellSearchField inputRef={inputRef} onInputReady={onInputReady} query={query} onQueryChange={(next) => { restoreRef.current = null; setQuery(next); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
        onComposingChange={setComposing} maxLength={INVEST_SEARCH_QUERY_MAX_LENGTH} />
      <ShellSearchControl close onClick={onClose} />
    </ShellSearchBar>
  </ShellSearchSurface>;
}
