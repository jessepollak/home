"use client";

import { useCallback, useSyncExternalStore } from "react";

export const showSmallBalancesPreferenceKey = "home.show-small-balances.v1";

const preferenceListeners = new Set<() => void>();

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type PreferenceStorageGetter<
  Method extends keyof PreferenceStorage = keyof PreferenceStorage,
> = () => Pick<PreferenceStorage, Method>;

function readShowSmallBalancesPreference(
  getStorage: PreferenceStorageGetter<"getItem">,
): boolean {
  try {
    return getStorage().getItem(showSmallBalancesPreferenceKey) === "true";
  } catch {
    return false;
  }
}

function writeShowSmallBalancesPreference(
  getStorage: PreferenceStorageGetter<"setItem">,
  value: boolean,
): boolean {
  try {
    getStorage().setItem(showSmallBalancesPreferenceKey, String(value));
    return true;
  } catch {
    return false;
  }
}

function notifyPreferenceListeners() {
  for (const listener of preferenceListeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== showSmallBalancesPreferenceKey) return;
  notifyPreferenceListeners();
}

function subscribeToShowSmallBalancesPreference(listener: () => void) {
  if (preferenceListeners.size === 0) window.addEventListener("storage", onStorage);
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
    if (preferenceListeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getShowSmallBalancesPreference() {
  return readShowSmallBalancesPreference(() => window.localStorage);
}

function getServerShowSmallBalancesPreference() {
  return false;
}

export function useShowSmallBalances(): readonly [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeToShowSmallBalancesPreference,
    getShowSmallBalancesPreference,
    getServerShowSmallBalancesPreference,
  );
  const update = useCallback((next: boolean) => {
    writeShowSmallBalancesPreference(() => window.localStorage, next);
    notifyPreferenceListeners();
  }, []);

  return [value, update] as const;
}
