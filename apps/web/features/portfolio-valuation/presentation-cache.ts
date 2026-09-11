"use client";

import { useMemo, useSyncExternalStore } from "react";
import { isRegionId, type RegionId } from "@/config/regions";
import { isAddress } from "@/features/formatting";
import type {
  HomeAssetBalanceItem,
  HomeAssetBalancesPresentation,
} from "./present-home-balances";

export const homeBalancesPresentationCachePrefix = "home.balances.v1:";
export const homeBalancesPresentationCacheTtlMs = 24 * 60 * 60 * 1000;
/** Rows include authoritative native-cash values and stable asset mark keys. */
export const homeBalancesPresentationSemanticVersion = "3.0.0";

export type CacheStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key"
> & { readonly length: number };

export type CacheStorageGetter = () => CacheStorage;

export type HomeBalancesPresentationCacheIdentity = {
  ownerKey: string;
  subject: string;
  smartAccount: `0x${string}`;
  region: RegionId;
};

const recordVersion = 1;
const maxIdentityLength = 200;
const maxLabelLength = 200;
const maxItemCount = 32;
const forbiddenIdentityPattern = /authorization|bearer\s|eyj[a-z0-9_-]{10,}\./i;
const cacheEventName = "home:balances-presentation-cache";

export function homeBalancesPresentationCacheKey(
  identity: Pick<HomeBalancesPresentationCacheIdentity, "subject" | "smartAccount" | "region">,
): string {
  return `${homeBalancesPresentationCachePrefix}${encodeURIComponent(identity.subject)}:${identity.smartAccount.toLowerCase()}:${identity.region}`;
}

export function writeHomeBalancesPresentation(
  getStorage: CacheStorageGetter,
  identity: HomeBalancesPresentationCacheIdentity,
  presentation: HomeAssetBalancesPresentation,
  now = Date.now(),
): boolean {
  const stored = serializeReadyPresentation(identity, presentation, now);
  if (!stored) return false;
  try {
    getStorage().setItem(
      homeBalancesPresentationCacheKey(identity),
      stored,
    );
    emitHomeBalancesPresentationCacheChange();
    return true;
  } catch {
    return false;
  }
}

export function readHomeBalancesPresentation(
  getStorage: CacheStorageGetter,
  lookup: {
    ownerKey: string;
    region: RegionId;
    subject?: string | null;
    smartAccount?: string | null;
  },
  now = Date.now(),
): HomeAssetBalancesPresentation | null {
  try {
    const storage = getStorage();
    if (lookup.subject && lookup.smartAccount && isAddress(lookup.smartAccount)) {
      const exact = parseStoredRecord(
        storage.getItem(
          homeBalancesPresentationCacheKey({
            subject: lookup.subject,
            smartAccount: lookup.smartAccount as `0x${string}`,
            region: lookup.region,
          }),
        ),
        now,
      );
      if (exact && identitiesMatch(exact, lookup)) {
        return exact.presentation;
      }
      return null;
    }

    return readByOwnerRegion(storage, lookup.ownerKey, lookup.region, now);
  } catch {
    return null;
  }
}

export function deleteHomeBalancesPresentation(
  getStorage: CacheStorageGetter,
  identity: Pick<
    HomeBalancesPresentationCacheIdentity,
    "subject" | "smartAccount" | "region"
  >,
): boolean {
  try {
    getStorage().removeItem(homeBalancesPresentationCacheKey(identity));
    emitHomeBalancesPresentationCacheChange();
    return true;
  } catch {
    return false;
  }
}

export function clearHomeBalancesPresentationCache(
  getStorage: CacheStorageGetter,
): boolean {
  try {
    const storage = getStorage();
    for (const key of listStorageKeys(storage)) {
      if (key.startsWith(homeBalancesPresentationCachePrefix)) {
        storage.removeItem(key);
      }
    }
    emitHomeBalancesPresentationCacheChange();
    return true;
  } catch {
    return false;
  }
}

export function subscribeHomeBalancesPresentationCache(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(cacheEventName, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(cacheEventName, onStoreChange);
  };
}

export function usePaintedHomeBalances(input: {
  ownerKey: string | null;
  subject?: string | null;
  smartAccount?: string | null;
  region: RegionId;
  live: HomeAssetBalancesPresentation;
}): HomeAssetBalancesPresentation {
  const cachedJson = useSyncExternalStore(
    subscribeHomeBalancesPresentationCache,
    () => snapshotCachedPresentation(input),
    () => "",
  );
  return useMemo(() => {
    if (!cachedJson) return input.live;
    try {
      const cached = JSON.parse(cachedJson) as HomeAssetBalancesPresentation;
      if (input.live.status === "ready") {
        return reconcileReadyHomeBalances(cached, input.live);
      }
      return {
        ...cached,
        statusLabel: cached.statusLabel ?? "Updating…",
        revalidating: true,
      };
    } catch {
      return input.live;
    }
  }, [cachedJson, input.live]);
}

function snapshotCachedPresentation(input: {
  ownerKey: string | null;
  subject?: string | null;
  smartAccount?: string | null;
  region: RegionId;
  live: HomeAssetBalancesPresentation;
}): string {
  if (!input.ownerKey) return "";
  if (
    input.live.status === "ready" &&
    (!input.subject || !input.smartAccount || !isAddress(input.smartAccount))
  ) {
    return "";
  }
  if (input.live.status !== "loading" && input.live.status !== "ready") return "";
  try {
    const cached = readHomeBalancesPresentation(
      () => window.localStorage,
      {
        ownerKey: input.ownerKey,
        region: input.region,
        subject: input.subject,
        smartAccount: input.smartAccount,
      },
    );
    return cached ? JSON.stringify(cached) : "";
  } catch {
    return "";
  }
}

function emitHomeBalancesPresentationCacheChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(cacheEventName));
}

export function resolvePaintedHomeBalances(input: {
  ownerKey: string | null;
  subject?: string | null;
  smartAccount?: string | null;
  region: RegionId;
  live: HomeAssetBalancesPresentation;
  getStorage: CacheStorageGetter;
  now?: number;
}): HomeAssetBalancesPresentation {
  if (!input.ownerKey) return input.live;
  if (
    input.live.status === "ready" &&
    (!input.subject || !input.smartAccount || !isAddress(input.smartAccount))
  ) {
    return input.live;
  }
  if (input.live.status !== "loading" && input.live.status !== "ready") {
    return input.live;
  }

  const cached = readHomeBalancesPresentation(
    input.getStorage,
    {
      ownerKey: input.ownerKey,
      region: input.region,
      subject: input.subject,
      smartAccount: input.smartAccount,
    },
    input.now,
  );
  if (!cached) return input.live;
  if (input.live.status === "ready") {
    return reconcileReadyHomeBalances(cached, input.live);
  }

  return {
    ...cached,
    statusLabel: cached.statusLabel ?? "Updating…",
    revalidating: true,
  };
}

function reconcileReadyHomeBalances(
  cached: HomeAssetBalancesPresentation,
  live: HomeAssetBalancesPresentation,
): HomeAssetBalancesPresentation {
  const unavailableIds = new Set(live.unavailableItemIds ?? []);
  if (unavailableIds.size === 0) return live;

  const liveById = new Map(live.items.map((item) => [item.id, item]));
  const mergedItems: HomeAssetBalanceItem[] = [];
  const includedIds = new Set<string>();
  let retainedUnavailableItem = false;

  for (const cachedItem of cached.items) {
    const liveItem = liveById.get(cachedItem.id);
    if (liveItem) {
      mergedItems.push(liveItem);
      includedIds.add(liveItem.id);
      continue;
    }
    if (!unavailableIds.has(cachedItem.id)) continue;

    const knownItem = { ...cachedItem };
    delete knownItem.displayContext;
    mergedItems.push({
      ...knownItem,
      displayBalance: "Unavailable",
      tone: "error",
    });
    includedIds.add(cachedItem.id);
    retainedUnavailableItem = true;
  }

  if (!retainedUnavailableItem) return live;
  for (const liveItem of live.items) {
    if (includedIds.has(liveItem.id)) continue;
    mergedItems.push(liveItem);
  }

  return {
    ...live,
    items: mergedItems,
  };
}

function readByOwnerRegion(
  storage: CacheStorage,
  ownerKey: string,
  region: RegionId,
  now: number,
): HomeAssetBalancesPresentation | null {
  const matches: ParsedRecord[] = [];
  for (const key of listStorageKeys(storage)) {
    if (!key.startsWith(homeBalancesPresentationCachePrefix)) continue;
    const parsed = parseStoredRecord(storage.getItem(key), now);
    if (!parsed) continue;
    if (parsed.ownerKey !== ownerKey || parsed.region !== region) continue;
    matches.push(parsed);
  }

  const accounts = new Set(
    matches.map((record) => record.smartAccount.toLowerCase()),
  );
  if (accounts.size !== 1) return null;
  return matches[0]?.presentation ?? null;
}

function identitiesMatch(
  record: ParsedRecord,
  lookup: {
    ownerKey: string;
    region: RegionId;
    subject?: string | null;
    smartAccount?: string | null;
  },
): boolean {
  if (record.ownerKey !== lookup.ownerKey) return false;
  if (record.region !== lookup.region) return false;
  if (lookup.subject && record.subject !== lookup.subject) return false;
  if (
    lookup.smartAccount &&
    record.smartAccount.toLowerCase() !== lookup.smartAccount.toLowerCase()
  ) {
    return false;
  }
  return true;
}

function serializeReadyPresentation(
  identity: HomeBalancesPresentationCacheIdentity,
  presentation: HomeAssetBalancesPresentation,
  now: number,
): string | null {
  if (!isSafeIdentity(identity.ownerKey) || !isSafeIdentity(identity.subject)) {
    return null;
  }
  if (!isAddress(identity.smartAccount) || !isRegionId(identity.region)) {
    return null;
  }
  const items = allowlistItems(presentation.items);
  if (
    presentation.status !== "ready" ||
    typeof presentation.displayTotal !== "string" ||
    presentation.displayTotal.length === 0 ||
    items === null
  ) {
    return null;
  }

  return JSON.stringify({
    v: recordVersion,
    presentationSemantics: homeBalancesPresentationSemanticVersion,
    ownerKey: identity.ownerKey,
    subject: identity.subject,
    smartAccount: identity.smartAccount.toLowerCase(),
    region: identity.region,
    savedAt: new Date(now).toISOString(),
    presentation: {
      status: "ready",
      displayTotal: presentation.displayTotal,
      ...(typeof presentation.statusLabel === "string" &&
      presentation.statusLabel.length > 0 &&
      presentation.statusLabel.length <= maxLabelLength
        ? { statusLabel: presentation.statusLabel }
        : {}),
      items,
    },
  });
}

type ParsedRecord = HomeBalancesPresentationCacheIdentity & {
  presentation: HomeAssetBalancesPresentation;
};

function parseStoredRecord(
  raw: string | null,
  now: number,
): ParsedRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const allowedKeys = [
    "v",
    "presentationSemantics",
    "ownerKey",
    "subject",
    "smartAccount",
    "region",
    "savedAt",
    "presentation",
  ];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) return null;
  if (
    record.v !== recordVersion ||
    record.presentationSemantics !== homeBalancesPresentationSemanticVersion
  ) {
    return null;
  }
  if (!isSafeIdentity(record.ownerKey) || !isSafeIdentity(record.subject)) {
    return null;
  }
  if (typeof record.smartAccount !== "string" || !isAddress(record.smartAccount)) {
    return null;
  }
  if (typeof record.region !== "string" || !isRegionId(record.region)) {
    return null;
  }
  if (typeof record.savedAt !== "string") {
    return null;
  }
  const savedAt = Date.parse(record.savedAt);
  if (!Number.isFinite(savedAt) || now - savedAt > homeBalancesPresentationCacheTtlMs) {
    return null;
  }
  if (savedAt > now + 60_000) return null;

  const presentation = allowlistPresentation(record.presentation);
  if (!presentation) return null;

  return {
    ownerKey: record.ownerKey,
    subject: record.subject,
    smartAccount: record.smartAccount.toLowerCase() as `0x${string}`,
    region: record.region,
    presentation,
  };
}

function allowlistPresentation(
  value: unknown,
): HomeAssetBalancesPresentation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const presentation = value as Record<string, unknown>;
  const allowedKeys = ["status", "displayTotal", "statusLabel", "items"];
  if (Object.keys(presentation).some((key) => !allowedKeys.includes(key))) {
    return null;
  }
  if (presentation.status !== "ready") return null;
  if (
    typeof presentation.displayTotal !== "string" ||
    presentation.displayTotal.length === 0 ||
    presentation.displayTotal.length > maxLabelLength
  ) {
    return null;
  }
  const items = allowlistItems(presentation.items);
  if (!items) return null;

  return {
    status: "ready",
    displayTotal: presentation.displayTotal,
    ...(typeof presentation.statusLabel === "string" &&
    presentation.statusLabel.length > 0 &&
    presentation.statusLabel.length <= maxLabelLength
      ? { statusLabel: presentation.statusLabel }
      : {}),
    items,
  };
}

function allowlistItems(value: unknown): HomeAssetBalanceItem[] | null {
  if (!Array.isArray(value) || value.length > maxItemCount) return null;
  const items: HomeAssetBalanceItem[] = [];
  for (const entry of value) {
    const item = allowlistItem(entry);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function allowlistItem(value: unknown): HomeAssetBalanceItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const allowedKeys = [
    "id",
    "assetKey",
    "group",
    "name",
    "detail",
    "displayBalance",
    "displayContext",
    "currencyCode",
    "tone",
  ];
  if (Object.keys(item).some((key) => !allowedKeys.includes(key))) return null;
  if (
    !isSafeLabel(item.id) ||
    (item.assetKey !== undefined && !isSafeLabel(item.assetKey)) ||
    !isSafeLabel(item.name)
  ) return null;
  if (
    typeof item.displayBalance !== "string" ||
    item.displayBalance.length === 0 ||
    item.displayBalance.length > maxLabelLength
  ) {
    return null;
  }
  if (item.group !== undefined && item.group !== "cash" && item.group !== "asset") {
    return null;
  }
  if (
    item.tone !== undefined &&
    item.tone !== "default" &&
    item.tone !== "muted" &&
    item.tone !== "error"
  ) {
    return null;
  }
  if (item.detail !== undefined && !isSafeLabel(item.detail)) return null;
  if (item.displayContext !== undefined && !isSafeLabel(item.displayContext)) {
    return null;
  }
  if (
    item.currencyCode !== undefined &&
    item.currencyCode !== null &&
    (typeof item.currencyCode !== "string" ||
      item.currencyCode.length === 0 ||
      item.currencyCode.length > 8)
  ) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    ...(typeof item.assetKey === "string" ? { assetKey: item.assetKey } : {}),
    displayBalance: item.displayBalance,
    ...(item.group ? { group: item.group } : {}),
    ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
    ...(typeof item.displayContext === "string"
      ? { displayContext: item.displayContext }
      : {}),
    ...(item.currencyCode === null || typeof item.currencyCode === "string"
      ? { currencyCode: item.currencyCode }
      : {}),
    ...(item.tone ? { tone: item.tone } : {}),
  };
}

function isSafeIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxIdentityLength &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    !forbiddenIdentityPattern.test(value)
  );
}

function isSafeLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLabelLength &&
    !value.includes("\n") &&
    !forbiddenIdentityPattern.test(value)
  );
}

function listStorageKeys(storage: CacheStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}
