"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  appearanceDarkClass,
  appearancePreferenceKey,
  appearanceThemeColors,
  parseAppearancePreference,
  resolveAppearance,
  type AppearancePreference,
  type ResolvedAppearance,
} from "@/shared/appearance/preference";

const listeners = new Set<() => void>();
let inMemoryPreference: AppearancePreference | null = null;
let systemQuery: MediaQueryList | null = null;
let rootObserver: MutationObserver | null = null;

function readPreference(): AppearancePreference {
  if (inMemoryPreference !== null) return inMemoryPreference;
  try {
    return parseAppearancePreference(window.localStorage.getItem(appearancePreferenceKey));
  } catch {
    return "system";
  }
}

function readSystemPrefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
}

function readResolvedAppearance(): ResolvedAppearance {
  return resolveAppearance(readPreference(), readSystemPrefersDark());
}

/** @public Reads the applied document appearance for consumers of the root theme contract. */
export function readAppliedAppearance(): ResolvedAppearance {
  return document.documentElement.classList.contains(appearanceDarkClass) ? "dark" : "light";
}

function notify() {
  for (const listener of listeners) listener();
}

function applyAppearance(resolved: ResolvedAppearance) {
  const root = document.documentElement;
  if (readAppliedAppearance() !== resolved) {
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { transition: none !important }";
    document.head.append(style);
    void root.offsetHeight;
    root.classList.toggle(appearanceDarkClass, resolved === "dark");
    void root.offsetHeight;
    window.requestAnimationFrame(() => style.remove());
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    appearanceThemeColors[resolved],
  );
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== appearancePreferenceKey) return;
  inMemoryPreference = null;
  applyAppearance(readResolvedAppearance());
  notify();
}

function onSystemChange() {
  if (readPreference() !== "system") return;
  applyAppearance(readResolvedAppearance());
  notify();
}

function listenForSystemChanges(): MediaQueryList | null {
  try {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    query?.addEventListener("change", onSystemChange);
    return query ?? null;
  } catch {
    return null;
  }
}

function observeAppliedAppearance(): MutationObserver | null {
  if (typeof MutationObserver === "undefined") return null;
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return observer;
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    systemQuery = listenForSystemChanges();
    rootObserver = observeAppliedAppearance();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      systemQuery?.removeEventListener("change", onSystemChange);
      systemQuery = null;
      rootObserver?.disconnect();
      rootObserver = null;
    }
  };
}

function getServerPreference(): AppearancePreference {
  return "system";
}

function getServerResolvedAppearance(): ResolvedAppearance {
  return "light";
}

export function useAppearance(): {
  preference: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  setAppearancePreference: (next: AppearancePreference) => boolean;
} {
  const preference = useSyncExternalStore(subscribe, readPreference, getServerPreference);
  const resolvedAppearance = useSyncExternalStore(
    subscribe,
    readAppliedAppearance,
    getServerResolvedAppearance,
  );
  const setAppearancePreference = useCallback((next: AppearancePreference) => {
    inMemoryPreference = next;
    let persisted = false;
    try {
      window.localStorage.setItem(appearancePreferenceKey, next);
      persisted = true;
      inMemoryPreference = null;
    } catch {
      persisted = false;
    }
    applyAppearance(resolveAppearance(next, readSystemPrefersDark()));
    notify();
    return persisted;
  }, []);

  return { preference, resolvedAppearance, setAppearancePreference };
}

export function AppearanceSync() {
  useEffect(() => {
    applyAppearance(readResolvedAppearance());
    notify();
    return subscribe(() => undefined);
  }, []);
  return null;
}
