"use client";

import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ChartNoAxesCombined, CreditCard, House, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { profileGlyph } from "@/client/account/basename-profile";
import { useBasenameProfile } from "@/client/account/use-basename-profile";
import { HomeMark } from "@/components/home-mark";
import { useReducedMotion } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { useOptionalSupport } from "@/client/support/support-provider";
import { SupportUnreadDot, supportUnreadLabel } from "@/components/profile-mark";
import { useNavLens } from "@/client/liquid-glass/use-nav-lens";
import {
  shellChromeCompensationClassName,
  shellWidthClassName,
} from "@/components/shell-layout";
import {
  navigationTabContentClassName,
  navigationTabIconClassName,
  navigationTabLabelClassName,
  navigationTabTone,
} from "@/components/primary-navigation-tab";
import {
  isHomeNestedPanelId,
  visibleNavigationItems,
  type NavigationId,
  type ShellPanelId,
} from "@/config/navigation";
import { useProductOffering } from "@/client/home/product-offering";
import { useShellKeyboardOpen, useShellViewportGeometry } from "./visual-viewport";
import styles from "./primary-navigation.module.css";
import { ShellSearchControl } from "./shell-search-controls";

type PrimaryNavigationProps = {
  layout?: "tabs" | "rail";
  activeNavigation: ShellPanelId;
  onNavigate: (id: NavigationId) => void;
  labels?: Partial<Record<NavigationId, string>>;
  cardsEnabled?: boolean;
  isAccountSettingsOpen?: boolean;
  account?: {
    status: "loading" | "ready";
    ownerKey: string | null;
    address: string | null;
    disabled: boolean;
  };
  onOpenAccount?: (opener: HTMLButtonElement) => void;
  onOpenSearch?: (opener: HTMLButtonElement) => void;
  searchOpen?: boolean;
};

const navigationIcons = {
  home: House,
  card: CreditCard,
  invest: ChartNoAxesCombined,
} satisfies Record<NavigationId, typeof House>;

type NavigationStyle = CSSProperties & Record<"--navigation-items", number>;

const railStorageKey = "home:sidebar:collapsed";
const railListeners = new Set<() => void>();
let inMemoryCollapsed: boolean | null = null;

function readCollapsed(): boolean {
  if (inMemoryCollapsed !== null) return inMemoryCollapsed;
  try {
    return window.localStorage.getItem(railStorageKey) === "true";
  } catch {
    return false;
  }
}

function subscribeRail(listener: () => void) {
  railListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== railStorageKey && event.key !== null) return;
    inMemoryCollapsed = null;
    for (const subscriber of railListeners) subscriber();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    railListeners.delete(listener);
    if (railListeners.size === 0) inMemoryCollapsed = null;
    window.removeEventListener("storage", onStorage);
  };
}

function persistCollapsed(next: boolean): boolean {
  try {
    window.localStorage.setItem(railStorageKey, String(next));
    return true;
  } catch {
    return false;
  }
}

function railSeam(panel: HTMLElement): number {
  const rect = panel.getBoundingClientRect();
  return panel.matches(":dir(rtl)") ? rect.left : rect.right;
}

function railFollowers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-rail-follower]"));
}

function railSlide(offset: number): Keyframe[] {
  return [{ transform: `translateX(${offset}px)` }, { transform: "none" }];
}

function railLabelClassName(collapsed: boolean, animated: boolean): string {
  const visibility = collapsed ? "opacity-0" : "opacity-100";
  if (!animated) return `truncate transition-none ${visibility}`;
  return `truncate transition-opacity ease-out motion-reduce:delay-0 motion-reduce:duration-0 ${visibility} ${collapsed ? "duration-[80ms] delay-0" : "duration-[100ms] delay-[80ms]"}`;
}

export function PrimaryNavigation({
  layout = "tabs",
  activeNavigation,
  onNavigate,
  labels,
  cardsEnabled = false,
  isAccountSettingsOpen = false,
  account,
  onOpenAccount,
  onOpenSearch,
  searchOpen = false,
}: PrimaryNavigationProps) {
  const { products } = useProductOffering();
  const visibleItems = useMemo(() => visibleNavigationItems({ cardsEnabled, investOffered: products.invest === "on" }), [cardsEnabled, products.invest]);
  const railSeamBefore = useRef<number | null>(null);
  const railPanelRef = useRef<HTMLDivElement>(null);
  const renderedCollapsed = useRef<boolean | null>(null);
  const subscribe = useCallback((listener: () => void) => subscribeRail(() => {
    if (railPanelRef.current && readCollapsed() !== renderedCollapsed.current) railSeamBefore.current = railSeam(railPanelRef.current);
    listener();
  }), []);
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const prefersReducedMotion = useReducedMotion();
  const [animated, setAnimated] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const railContentRef = useRef<HTMLDivElement>(null);
  const railAnimations = useRef<Animation[]>([]);
  const railClip = useRef<HTMLElement | null>(null);
  const [direction, setDirection] = useState("ltr");
  const [motionReady, setMotionReady] = useState(false);
  useShellViewportGeometry(layout === "tabs");
  const keyboardOpen = useShellKeyboardOpen(layout === "tabs");
  const NavLens = useNavLens();
  const navigationLens = visibleItems.length > 1 ? NavLens : null;
  const [lensReady, setLensReady] = useState(false);
  const chromeHidden = keyboardOpen || searchOpen;
  const keyboardHidden = keyboardOpen && !searchOpen;

  const activeIndex = (isAccountSettingsOpen || searchOpen) && layout === "rail" ? -1 : visibleItems.findIndex((item) =>
    activeNavigation === item.id ||
    (item.id === "home" && isHomeNestedPanelId(activeNavigation)));
  const pillOffStart = activeIndex > 0;
  useLayoutEffect(() => {
    if (pillOffStart && navRef.current) setDirection(navRef.current.matches(":dir(rtl)") ? "rtl" : "ltr");
  }, [pillOffStart]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMotionReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);


  const toggle = () => {
    setAnimated(true);
    const next = !collapsed;
    inMemoryCollapsed = next;
    persistCollapsed(next);
    for (const listener of railListeners) listener();
  };
  const lensTarget = activeIndex > 0 ? activeIndex * (direction === "rtl" ? -1 : 1) : 0;
  const lensItems = useMemo(() => visibleItems.map((item) => ({
    id: item.id,
    label: labels?.[item.id] ?? item.label,
    Icon: navigationIcons[item.id],
  })), [labels, visibleItems]);
  const navigationStyle: NavigationStyle = { "--navigation-items": visibleItems.length };
  useLayoutEffect(() => {
    if (layout === "rail") document.documentElement.style.setProperty("--shell-rail-width", collapsed ? "4rem" : "15rem");
  }, [layout, collapsed]);
  const stopRailMotion = useCallback(() => {
    for (const animation of railAnimations.current) animation.cancel();
    railAnimations.current = [];
    railClip.current?.style.removeProperty("overflow-x");
    railClip.current = null;
  }, []);
  useEffect(() => stopRailMotion, [stopRailMotion]);
  useLayoutEffect(() => {
    const from = railSeamBefore.current;
    railSeamBefore.current = null;
    renderedCollapsed.current = collapsed;
    stopRailMotion();
    const panel = railPanelRef.current;
    const content = railContentRef.current;
    if (from === null || prefersReducedMotion || !panel || !content) return;
    const offset = from - railSeam(panel);
    if (offset === 0) return;
    const timing: KeyframeAnimationOptions = { duration: 180, easing: "cubic-bezier(0, 0, 0.2, 1)" };
    const followers = railFollowers();
    const animations = [panel.animate(railSlide(offset), timing), content.animate(railSlide(-offset), timing),
      ...followers.map((follower) => follower.animate(railSlide(offset), timing))];
    railAnimations.current = animations;
    const container = followers[0]?.closest<HTMLElement>("[data-rail-column]");
    if (!container) return;
    container.style.overflowX = "clip";
    railClip.current = container;
    animations[0].onfinish = () => { if (railAnimations.current === animations) stopRailMotion(); };
  }, [collapsed, prefersReducedMotion, stopRailMotion]);

  if (layout === "rail") {
    const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
    return (
      <aside
        id="desktop-rail"
        data-rail-state={collapsed ? "collapsed" : "expanded"}
        data-rail-motion={animated ? "animated" : "static"}
        className={`hidden shrink-0 lg:sticky lg:top-0 lg:flex lg:h-svh ${collapsed ? "w-16" : "w-60"}`}
      >
        <div ref={railPanelRef} className={`absolute inset-y-0 start-0 w-60 overflow-hidden border-e bg-background ${collapsed ? "-translate-x-44 rtl:translate-x-44" : ""}`}>
        <div ref={railContentRef} className={`flex h-full w-60 shrink-0 flex-col ${collapsed ? "translate-x-44 rtl:-translate-x-44" : ""}`}>
          <div className="flex h-14 shrink-0 items-center px-2.5">
            <HomeMark compact onClick={() => onNavigate("home")} data-breakpoint-peer="home-mark" data-breakpoint-fallback="nav-home" />
          </div>
          <nav className="flex flex-col gap-2 px-2.5 py-4" aria-label="Main navigation">
            {visibleItems.map((item, index) => {
              const Icon = navigationIcons[item.id];
              const isActive = index === activeIndex;
              const label = labels?.[item.id] ?? item.label;
              return (
                <Button
                  key={item.id}
                  id={`${item.id}-rail-nav`}
                  data-breakpoint-peer={`nav-${item.id}`}
                  variant="navigation"
                  size="lg"
                  className={`relative h-11 min-w-0 justify-start gap-3 overflow-hidden px-3 ${collapsed ? "w-11" : "w-full"}`}
                  onClick={() => onNavigate(item.id)}
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                  aria-controls="navigation-panel"
                >
                  {isActive ? <span className="absolute start-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true" /> : null}
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span aria-hidden={collapsed} className={railLabelClassName(collapsed, animated)}>{label}</span>
                </Button>
              );
            })}
            {onOpenSearch ? <Button variant="navigation" size="lg" className={`h-11 justify-start gap-3 px-3 ${collapsed ? "w-11" : "w-full"}`}
              aria-label="Search assets" aria-expanded={searchOpen} aria-controls="asset-search-surface" data-shell-search-opener="" data-breakpoint-peer="asset-search"
              onClick={(event) => { if (!searchOpen) onOpenSearch(event.currentTarget); }}>
              <Search className="size-5 shrink-0" aria-hidden="true" /><span aria-hidden={collapsed} className={railLabelClassName(collapsed, animated)}>Search</span>
            </Button> : null}
          </nav>
          <div className="mt-auto">
            <div className="px-2.5 pb-2">
              <Button variant="navigation" size="icon" className="size-11" aria-label="Sidebar" aria-expanded={!collapsed} aria-controls="desktop-rail" data-breakpoint-peer="sidebar-toggle" data-breakpoint-fallback="nav-home" onClick={toggle}>
                <ToggleIcon className="size-5 rtl:-scale-x-100" aria-hidden="true" />
              </Button>
            </div>
            {account ? (
              <div className="border-t px-2.5 py-3">
                <RailAccountButton
                  account={account}
                  collapsed={collapsed}
                  animated={animated}
                  current={isAccountSettingsOpen}
                  onOpenAccount={onOpenAccount}
                />
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </aside>
    );
  }

  return (
    <div aria-hidden={chromeHidden ? true : undefined} inert={chromeHidden} data-keyboard-hidden={keyboardHidden ? "true" : undefined}
      data-shell-viewport=""
      data-search-open={searchOpen ? "" : undefined} className={`${onOpenSearch ? `${styles.group} fixed inset-x-0 z-30 flex items-center justify-between gap-2` : "contents"} lg:hidden ${shellChromeCompensationClassName}`}>
      <nav
        ref={navRef}
        aria-label="Main navigation"
        aria-hidden={chromeHidden ? true : undefined}
        inert={chromeHidden}
        data-keyboard-hidden={keyboardHidden ? "true" : undefined}
        data-navigation-items={visibleItems.length}
        data-shell-viewport=""
        data-lens={navigationLens && lensReady ? "ready" : undefined}
        style={navigationStyle}
        className={`${shellWidthClassName} ${styles.navigation} ${onOpenSearch ? styles.withSearch : ""} ${motionReady && !prefersReducedMotion ? styles.motionReady : ""} fixed inset-x-0 z-30 grid rounded-full p-1 opacity-100`}
      >
        <span aria-hidden="true" data-navigation-floor="" className={`${styles.floor} pointer-events-none absolute inset-0 rounded-full`} />
        <span
          aria-hidden="true"
          data-navigation-pill=""
          className={`${styles.pill} pointer-events-none absolute inset-y-1 start-1 rounded-full bg-foreground/10 dark:bg-foreground/15`}
          style={{ transform: `translateX(${lensTarget * 100}%)` }}
        />
        {visibleItems.map((item, index) => {
          const Icon = navigationIcons[item.id];
          const isActive = index === activeIndex;
          const tone = navigationTabTone[isActive ? "selected" : "unselected"];
          return (
            <Button
              key={item.id}
              id={`${item.id}-nav`}
              data-breakpoint-peer={`nav-${item.id}`}
              variant="navigation"
              size="tab"
              className="relative z-10 min-w-0 w-full"
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? "page" : undefined}
              aria-controls="navigation-panel"
            >
              <span className={`${styles.content} ${navigationTabContentClassName}`}>
                <Icon className={`${navigationTabIconClassName} ${tone.icon}`} aria-hidden="true" />
                <span className={`${navigationTabLabelClassName} ${tone.label}`}>{labels?.[item.id] ?? item.label}</span>
              </span>
            </Button>
          );
        })}
        {navigationLens && activeIndex >= 0 ? (
          createElement(navigationLens, { items: lensItems, target: lensTarget, reducedMotion: prefersReducedMotion, onReadyChange: setLensReady })
        ) : null}
      </nav>
      {onOpenSearch ? <ShellSearchControl morphOrigin data-shell-search-opener="" data-breakpoint-peer="asset-search" aria-expanded={searchOpen} aria-controls="asset-search-surface"
        onClick={(event) => onOpenSearch(event.currentTarget)} /> : null}
    </div>
  );
}

function RailAccountButton({
  account,
  collapsed,
  animated,
  current,
  onOpenAccount,
}: {
  account: PrimaryNavigationProps["account"];
  collapsed: boolean;
  animated: boolean;
  current: boolean;
  onOpenAccount?: (opener: HTMLButtonElement) => void;
}) {
  const ready = account?.status === "ready";
  const support = useOptionalSupport();
  const unreadCount = ready ? support?.unreadCount ?? null : null;
  const summaryStatus = ready ? support?.summaryStatus : undefined;
  const profile = useBasenameProfile({
    ownerKey: account?.ownerKey,
    address: account?.address,
    enabled: ready,
  });
  const basename = ready ? profile.data?.name ?? null : null;
  const glyph = ready
    ? profileGlyph({ basename, ownerKey: account?.ownerKey, address: account?.address })
    : null;
  return (
    <Button
      variant="ghost"
      size="lg"
      className={`relative h-11 justify-start gap-1 overflow-hidden px-0 ${collapsed ? "w-11" : "w-full"}`}
      aria-label={supportUnreadLabel(basename ? `Account settings ${basename}` : "Account settings", unreadCount, summaryStatus)}
      aria-current={current ? "page" : undefined}
      disabled={account?.disabled}
      onClick={(event) => { if (!current) onOpenAccount?.(event.currentTarget); }}
      data-rail-account-action=""
      data-breakpoint-peer="account"
      data-breakpoint-fallback="account-settings"
    >
      {current ? <span className="absolute start-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true" /> : null}
      <span className="relative grid size-11 shrink-0 place-items-center" aria-hidden="true">
        <SupportUnreadDot unreadCount={unreadCount} status={summaryStatus} />
        <span className={`grid size-8 place-items-center rounded-full bg-muted text-sm font-semibold lowercase text-foreground ${ready ? "" : "animate-pulse"}`} data-shimmer={ready ? undefined : "profile"}>
          {glyph}
        </span>
      </span>
      <span aria-hidden={collapsed} className={railLabelClassName(collapsed, animated)}>{basename ?? "Account"}</span>
    </Button>
  );
}
