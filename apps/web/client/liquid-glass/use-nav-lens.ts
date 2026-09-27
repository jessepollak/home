"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import { reportClientError } from "@/client/observability/client-reporter";
import { navLensQueries, shouldMountNavLens, type NavLensEnvironment } from "./lens-gate";

export type NavLensItem = {
  id: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export type NavLensStatus = "moving" | "resting";

export type NavLensProps = {
  items: readonly NavLensItem[];
  target: number;
  reducedMotion: boolean;
  onStatusChange: (status: NavLensStatus | null) => void;
};

type NavLensComponent = ComponentType<NavLensProps>;

let loaded: NavLensComponent | null = null;
let pending: Promise<NavLensComponent> | null = null;

function loadNavLens() {
  pending ??= import("./nav-lens").then((module) => {
    loaded = module.NavLens;
    return module.NavLens;
  });
  return pending;
}

function supportsBackdropFilter() {
  return typeof CSS !== "undefined"
    && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));
}

export function readNavLensEnvironment(): NavLensEnvironment {
  const matches = (query: string) => window.matchMedia(query).matches;
  return {
    mobileLayout: matches(navLensQueries.mobileLayout),
    reducedTransparency: matches(navLensQueries.reducedTransparency),
    forcedColors: matches(navLensQueries.forcedColors),
    backdropFilter: supportsBackdropFilter(),
  };
}

function readEnabled() {
  return shouldMountNavLens(readNavLensEnvironment());
}

function subscribe(onChange: () => void) {
  const lists = Object.values(navLensQueries).map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => { for (const list of lists) list.removeEventListener("change", onChange); };
}

export function useNavLens(): NavLensComponent | null {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  const [component, setComponent] = useState<NavLensComponent | null>(() => loaded);

  useEffect(() => {
    if (!enabled || component) return;
    let cancelled = false;
    const load = () => {
      loadNavLens().then(
        (lens) => { if (!cancelled) setComponent(() => lens); },
        (error: unknown) => {
          pending = null;
          void reportClientError({
            name: error instanceof Error ? error.name : "Error",
            message: "The navigation lens failed to load.",
            route: window.location.pathname,
          });
        },
      );
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(load, { timeout: 2_000 });
      return () => { cancelled = true; window.cancelIdleCallback(handle); };
    }
    const handle = window.setTimeout(load, 500);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [enabled, component]);

  return enabled ? component : null;
}
