"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SHELL_SEARCH_PARAM, backClientHistory, commitClientUrl, parseShellOverlayIntent, shellHref } from "@/config/shell-location";
import { useShellKeyboardOpen } from "@/components/visual-viewport";
import { isRecord } from "@/shared/guards";
import type { HomeExperienceProps, ShellSearchContentProps } from "./home-types";

type SearchDetailTarget = { href: string; assetId: string; query: string; token: string };
type SearchState = { open: boolean; openSearch?: (opener: HTMLButtonElement) => void };
const SearchStateContext = createContext<SearchState>({ open: false });
const SearchSurfaceContext = createContext<ReactNode>(null);
const RouteSearchContext = createContext("");

export function ShellRouteSearchProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const value = useMemo(() => {
    const search = new URLSearchParams(searchParams.toString());
    search.delete(SHELL_SEARCH_PARAM);
    return search.toString();
  }, [searchParams]);
  return <RouteSearchContext value={value}>{children}</RouteSearchContext>;
}

export function useShellRouteSearch() {
  return useContext(RouteSearchContext);
}

function assetSearchEntry() {
  if (typeof window === "undefined") return null;
  const value: unknown = window.history.state;
  const state = isRecord(value) ? value : {};
  return { href: `${window.location.pathname}${window.location.search}`, state: {
    assetSearchPushed: state.assetSearchPushed === true,
    assetSearchOriginY: typeof state.assetSearchOriginY === "number" ? state.assetSearchOriginY : 0,
    assetSearchOriginOwner: typeof state.assetSearchOriginOwner === "string" ? state.assetSearchOriginOwner : null,
    assetSearchScrollTop: typeof state.assetSearchScrollTop === "number" ? state.assetSearchScrollTop : 0,
    assetSearchResult: typeof state.assetSearchResult === "string" ? state.assetSearchResult : null,
  } };
}

function ShellSearchSlot({ content, ...props }: ShellSearchContentProps & { content: NonNullable<HomeExperienceProps["searchContent"]> }) {
  return content(props);
}

export function ShellSearchProvider({ children, content, available, signedOut, ownerKey, shellRef, detailTargetRef, onLeaveSearch }: {
  children: ReactNode;
  content: HomeExperienceProps["searchContent"];
  available: boolean;
  signedOut: boolean;
  ownerKey: string | null;
  shellRef: RefObject<HTMLDivElement | null>;
  detailTargetRef: RefObject<SearchDetailTarget | null>;
  onLeaveSearch: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [urlSearchOverride, setUrlSearchOverride] = useState<string | null>(null);
  const routeSearch = `${pathname}?${searchParams}`;
  const [syncedRouteSearch, setSyncedRouteSearch] = useState(routeSearch);
  if (syncedRouteSearch !== routeSearch) {
    setSyncedRouteSearch(routeSearch);
    setUrlSearchOverride(null);
  }
  const currentSearch = new URLSearchParams(urlSearchOverride ?? searchParams.toString());
  const currentSearchString = currentSearch.toString();
  const query = parseShellOverlayIntent(currentSearch).search;
  const searchOpen = Boolean(content && available && !signedOut && query !== null);
  const searchHref = `${pathname}${currentSearchString ? `?${currentSearchString}` : ""}`;
  const [searchEntry, setSearchEntry] = useState(assetSearchEntry);
  const currentSearchEntry = searchEntry?.href === searchHref ? searchEntry : assetSearchEntry();
  const searchRestoration = currentSearchEntry?.href === searchHref ? currentSearchEntry.state : null;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchOpenerRef = useRef<HTMLButtonElement | null>(null);
  const wasSearchOpenRef = useRef(false);
  const searchOriginPathRef = useRef(pathname);
  const searchOriginOwnerRef = useRef(ownerKey);
  const [searchFocusPending, setSearchFocusPending] = useState(false);
  const keyboardOpen = useShellKeyboardOpen();

  useEffect(() => {
    const onPop = () => { setSearchEntry(assetSearchEntry()); setUrlSearchOverride(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const onSearchInputReady = useCallback((input: HTMLInputElement | null) => { searchInputRef.current = input; }, []);
  const commitSearchQuery = useCallback((nextQuery: string) => {
    const next = new URL(window.location.href);
    if (!next.searchParams.has(SHELL_SEARCH_PARAM) || next.searchParams.get(SHELL_SEARCH_PARAM) === nextQuery) return;
    next.searchParams.set(SHELL_SEARCH_PARAM, nextQuery);
    commitClientUrl(`${next.pathname}${next.search}`, "replace", undefined, true);
    setSearchEntry((saved) => saved ? { ...saved, href: `${next.pathname}${next.search}` } : assetSearchEntry());
    setUrlSearchOverride(next.search);
  }, []);
  const openSearch = useCallback((opener: HTMLButtonElement) => {
    detailTargetRef.current = null;
    const next = new URL(window.location.href);
    searchOpenerRef.current = opener;
    window.history.replaceState({ ...window.history.state, assetSearchOriginY: window.scrollY, assetSearchOriginOwner: ownerKey }, "");
    next.searchParams.set(SHELL_SEARCH_PARAM, "");
    commitClientUrl(`${next.pathname}${next.search}`, "push", { assetSearchPushed: true, assetSearchScrollTop: 0, assetSearchResult: null }, true);
    flushSync(() => { setSearchEntry(assetSearchEntry()); setUrlSearchOverride(next.search); });
    searchInputRef.current?.focus({ preventScroll: true });
  }, [detailTargetRef, ownerKey]);
  const closeSearch = useCallback(() => {
    detailTargetRef.current = null;
    const saved = searchEntry;
    const historyState: unknown = window.history.state;
    if ((isRecord(historyState) && historyState.assetSearchPushed === true) || (saved?.href === `${window.location.pathname}${window.location.search}` && saved.state.assetSearchPushed)) { backClientHistory(); return; }
    const next = new URL(window.location.href);
    next.searchParams.delete(SHELL_SEARCH_PARAM);
    commitClientUrl(`${next.pathname}${next.search}`, "replace", undefined, true);
    setUrlSearchOverride(next.search);
  }, [detailTargetRef, searchEntry]);
  const openSearchAsset = useCallback((assetId: string, nextQuery: string, scrollTop: number) => {
    const next = new URL(window.location.href);
    next.searchParams.set(SHELL_SEARCH_PARAM, nextQuery);
    commitClientUrl(`${next.pathname}${next.search}`, "replace", { assetSearchScrollTop: scrollTop, assetSearchResult: assetId });
    setSearchEntry(assetSearchEntry());
    const href = shellHref({ panel: "invest", asset: assetId });
    const token = crypto.randomUUID();
    detailTargetRef.current = { href, assetId, query: nextQuery, token };
    setUrlSearchOverride(null);
    onLeaveSearch();
    router.push(`${href}#asset-search-${token}`, { scroll: false });
  }, [detailTargetRef, onLeaveSearch, router]);
  useLayoutEffect(() => {
    const saved = searchEntry;
    if (saved?.href === `${pathname}${currentSearchString ? `?${currentSearchString}` : ""}` && searchOpen) {
      const value: unknown = window.history.state;
      if (!isRecord(value) || Object.entries(saved.state).some(([key, item]) => value[key] !== item)) window.history.replaceState({ ...window.history.state, ...saved.state }, "");
    }
    if (searchOpen) { wasSearchOpenRef.current = true; searchOriginPathRef.current = pathname; searchOriginOwnerRef.current = ownerKey; return; }
    if (!wasSearchOpenRef.current) return;
    wasSearchOpenRef.current = false;
    if (pathname !== searchOriginPathRef.current || ownerKey !== searchOriginOwnerRef.current || !available || signedOut) return;
    const value: unknown = window.history.state;
    if (isRecord(value) && value.assetSearchOriginOwner === ownerKey && typeof value.assetSearchOriginY === "number" && Number.isFinite(value.assetSearchOriginY) && value.assetSearchOriginY >= 0 && Math.abs(window.scrollY - value.assetSearchOriginY) > 1) window.scrollTo(0, value.assetSearchOriginY);
    setSearchFocusPending(true);
  }, [searchEntry, pathname, currentSearchString, searchOpen, ownerKey, available, signedOut]);
  useLayoutEffect(() => {
    if (!searchFocusPending) return;
    if (searchOpen || pathname !== searchOriginPathRef.current || ownerKey !== searchOriginOwnerRef.current || !available || signedOut) { setSearchFocusPending(false); return; }
    const onFocus = (event: FocusEvent) => {
      if (event.target !== document.body && event.target !== document.documentElement) setSearchFocusPending(false);
    };
    const restore = () => {
      const visible = (button: HTMLButtonElement | null): button is HTMLButtonElement =>
        Boolean(button?.isConnected && !button.disabled && !button.closest('[inert], [aria-hidden="true"]') && button.getClientRects().length > 0);
      const controls = [...(shellRef.current?.querySelectorAll<HTMLButtonElement>("[data-shell-search-opener]") ?? [])];
      const previous = searchOpenerRef.current;
      const target = visible(previous) ? previous : controls.find(visible);
      if (!target) return;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) setSearchFocusPending(false);
    };
    document.addEventListener("focusin", onFocus);
    restore();
    const frame = requestAnimationFrame(restore);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("focusin", onFocus); };
  }, [searchFocusPending, searchOpen, pathname, keyboardOpen, ownerKey, available, signedOut, shellRef]);
  const state = useMemo(() => ({ open: searchOpen, openSearch: available ? openSearch : undefined }), [searchOpen, available, openSearch]);
  const surface = useMemo(() => <AnimatePresence key={`${pathname}:${ownerKey}:${available}:${signedOut}`}>
    {searchOpen && content ? <ShellSearchSlot key="search" content={content} initialQuery={query ?? ""} initialScrollTop={searchRestoration?.assetSearchScrollTop ?? 0} initialResultId={searchRestoration?.assetSearchResult ?? null} onInputReady={onSearchInputReady} onClose={closeSearch} onQueryCommit={commitSearchQuery} onOpenAsset={openSearchAsset} /> : null}
  </AnimatePresence>, [pathname, ownerKey, available, signedOut, searchOpen, content, query, searchRestoration?.assetSearchScrollTop, searchRestoration?.assetSearchResult, onSearchInputReady, closeSearch, commitSearchQuery, openSearchAsset]);
  return <SearchStateContext value={state}><SearchSurfaceContext value={surface}>{children}</SearchSurfaceContext></SearchStateContext>;
}

export function useShellSearch() {
  return useContext(SearchStateContext);
}

export function ShellSearchSurfaceSlot() {
  return useContext(SearchSurfaceContext);
}

export function ShellSearchInert({ children }: { children: ReactNode }) {
  const { open } = useShellSearch();
  return <div className="contents" inert={open} aria-hidden={open ? true : undefined}>{children}</div>;
}
