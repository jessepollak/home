"use client";

import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChartNoAxesCombined, House, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { profileGlyph } from "@/client/account/basename-profile";
import { useBasenameProfile } from "@/client/account/use-basename-profile";
import { HomeMark } from "@/components/home-mark";
import { useReducedMotion } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { useNavLens } from "@/client/liquid-glass/use-nav-lens";
import {
  shellChromeCompensationClassName,
  shellWidthClassName,
} from "@/components/shell-layout";
import {
  navigationTabContentClassName,
  navigationTabIconClassName,
  navigationTabLabelClassName,
} from "@/components/primary-navigation-tab";
import {
  isHomeNestedPanelId,
  navigationItems,
  type NavigationId,
  type ShellPanelId,
} from "@/config/navigation";
import { visualViewportKeyboardInset } from "./visual-viewport";
import styles from "./primary-navigation.module.css";

type PrimaryNavigationProps = {
  layout?: "tabs" | "rail";
  activeNavigation: ShellPanelId;
  onNavigate: (id: NavigationId) => void;
  labels?: Partial<Record<NavigationId, string>>;
  isAccountSettingsOpen?: boolean;
  account?: {
    status: "loading" | "ready";
    ownerKey: string | null;
    address: string | null;
    disabled: boolean;
  };
  onOpenAccount?: (opener: HTMLButtonElement) => void;
};

const navigationIcons = {
  home: House,
  invest: ChartNoAxesCombined,
} satisfies Record<NavigationId, typeof House>;

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
  isAccountSettingsOpen = false,
  account,
  onOpenAccount,
}: PrimaryNavigationProps) {
  const collapsed = useSyncExternalStore(subscribeRail, readCollapsed, () => false);
  const prefersReducedMotion = useReducedMotion();
  const [animated, setAnimated] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [direction, setDirection] = useState("ltr");
  const [motionReady, setMotionReady] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const NavLens = useNavLens();
  const [lensReady, setLensReady] = useState(false);

  useLayoutEffect(() => {
    if (navRef.current) setDirection(getComputedStyle(navRef.current).direction);
  }, [activeNavigation]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMotionReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (layout === "rail") return;
    const viewport = window.visualViewport;
    const update = () => {
      const target = document.activeElement;
      setKeyboardOpen(window.matchMedia("(max-width: 63.9375rem)").matches &&
        target instanceof HTMLElement && !!target.closest("#navigation-panel") &&
        (target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || target.isContentEditable) &&
        !!viewport && visualViewportKeyboardInset(window.innerHeight, viewport) > 0);
    };
    const deferUpdate = () => requestAnimationFrame(update);
    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", deferUpdate);
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", deferUpdate);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [layout]);

  const toggle = () => {
    setAnimated(true);
    const next = !collapsed;
    inMemoryCollapsed = next;
    persistCollapsed(next);
    for (const listener of railListeners) listener();
  };
  const activeIndex = isAccountSettingsOpen && layout === "rail" ? -1 : navigationItems.findIndex((item) =>
    activeNavigation === item.id ||
    (item.id === "home" && isHomeNestedPanelId(activeNavigation)));
  const lensTarget = activeIndex > 0 ? (direction === "rtl" ? -1 : 1) : 0;
  const lensItems = useMemo(() => navigationItems.map((item) => ({
    id: item.id,
    label: labels?.[item.id] ?? item.label,
    Icon: navigationIcons[item.id],
  })), [labels]);

  if (layout === "rail") {
    const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
    return (
      <aside
        id="desktop-rail"
        data-rail-state={collapsed ? "collapsed" : "expanded"}
        data-rail-motion={animated ? "animated" : "static"}
        className={`hidden h-full shrink-0 overflow-hidden border-e bg-background lg:flex ${animated ? "transition-[width] duration-[180ms] ease-out motion-reduce:transition-none" : "transition-none"} ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className="flex h-full w-60 shrink-0 flex-col">
          <div className="flex h-14 shrink-0 items-center px-2.5">
            <HomeMark compact onClick={() => onNavigate("home")} data-breakpoint-peer="home-mark" data-breakpoint-fallback="nav-home" />
          </div>
          <nav className="flex flex-col gap-2 px-2.5 py-4" aria-label="Main navigation">
            {navigationItems.map((item, index) => {
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
      </aside>
    );
  }

  return (
    <div className={`contents lg:hidden ${shellChromeCompensationClassName}`}>
      <nav
        ref={navRef}
        aria-label="Main navigation"
        aria-hidden={keyboardOpen ? true : undefined}
        inert={keyboardOpen}
        data-keyboard-hidden={keyboardOpen ? "true" : undefined}
        data-lens={NavLens && lensReady ? "ready" : undefined}
        className={`${shellWidthClassName} ${styles.navigation} ${motionReady && !prefersReducedMotion ? styles.motionReady : ""} fixed inset-x-0 z-30 grid grid-cols-2 rounded-full p-1 opacity-100`}
      >
        <span aria-hidden="true" data-navigation-floor="" className={`${styles.floor} pointer-events-none absolute inset-0 rounded-full`} />
        <span
          aria-hidden="true"
          data-navigation-pill=""
          className={`${styles.pill} pointer-events-none absolute inset-y-1 start-1 rounded-full bg-foreground/10 dark:bg-foreground/15`}
          style={{ transform: `translateX(${lensTarget * 100}%)` }}
        />
        {navigationItems.map((item, index) => {
          const Icon = navigationIcons[item.id];
          const isActive = index === activeIndex;
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
                <Icon className={`${navigationTabIconClassName} ${isActive ? "text-primary" : "text-foreground/70"}`} aria-hidden="true" />
                <span className={`${navigationTabLabelClassName} ${isActive ? "text-foreground" : "text-foreground/70"}`}>{labels?.[item.id] ?? item.label}</span>
              </span>
            </Button>
          );
        })}
        {NavLens && activeIndex >= 0 ? (
          createElement(NavLens, { items: lensItems, target: lensTarget, reducedMotion: prefersReducedMotion, onReadyChange: setLensReady })
        ) : null}
      </nav>
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
      aria-label={basename ? `Account settings ${basename}` : "Account settings"}
      aria-current={current ? "page" : undefined}
      disabled={account?.disabled}
      onClick={(event) => { if (!current) onOpenAccount?.(event.currentTarget); }}
      data-rail-account-action=""
      data-breakpoint-peer="account"
      data-breakpoint-fallback="account-settings"
    >
      {current ? <span className="absolute start-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true" /> : null}
      <span className="grid size-11 shrink-0 place-items-center" aria-hidden="true">
        <span className={`grid size-8 place-items-center rounded-full bg-muted text-sm font-semibold lowercase text-foreground ${ready ? "" : "animate-pulse"}`} data-shimmer={ready ? undefined : "profile"}>
          {glyph}
        </span>
      </span>
      <span aria-hidden={collapsed} className={railLabelClassName(collapsed, animated)}>{basename ?? "Account"}</span>
    </Button>
  );
}
