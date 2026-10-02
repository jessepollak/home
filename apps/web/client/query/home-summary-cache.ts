import { writeHomeSummaryCookie } from "./home-summary-cookie";
import type { RegionId } from "@/config/regions";
import type { HomeBalancesPresentation } from "@/shared/balances/present";
import { isSafeQueryIdentity, ownerQueryStorageKey } from "./query-client";

import { parseHomeSummaryRecord, recentHomeRates, homeSummaryPresentation, type HomeRateLabels } from "@/shared/balances/home-summary";
export type { HomeRateLabels, HomeRateObservation } from "@/shared/balances/home-summary";

export function homeSummaryStorageKey(owner: string, region: RegionId): string {
  return `${ownerQueryStorageKey(owner)}:home-summary:${region}`;
}

function readRecord(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, now = Date.now()) {
  if (!isSafeQueryIdentity(owner)) return null;
  try {
    const value = storage.getItem(homeSummaryStorageKey(owner, region));
    return parseHomeSummaryRecord(value ?? undefined, owner, region, now);
  } catch { return null; }
}

export function readHomeSummary(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, now = Date.now()): HomeBalancesPresentation | null {
  const record = readRecord(storage, owner, region, now);
  return record ? homeSummaryPresentation(record) : null;
}

export function readHomeRateLabels(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, now = Date.now()): HomeRateLabels {
  return recentHomeRates(readRecord(storage, owner, region, now)?.rates, now);
}

export function writeHomeRateLabels(storage: Pick<Storage, "getItem" | "setItem">, owner: string, region: RegionId, rates: HomeRateLabels): boolean {
  const record = readRecord(storage, owner, region);
  if (!record) return false;
  const merged = { ...record.rates };
  for (const key of ["cash", "borrow"] as const) {
    const incoming = rates[key];
    if (!incoming || !Number.isFinite(incoming.updatedAt) || incoming.updatedAt < 0 || incoming.updatedAt > Date.now()) continue;
    if ((merged[key]?.updatedAt ?? 0) > incoming.updatedAt) continue;
    merged[key] = incoming;
  }
  const parsed = parseHomeSummaryRecord(JSON.stringify({ ...record, rates: merged }), owner, region);
  if (!parsed) return false;
  try {
    const value = JSON.stringify(parsed);
    if (value.length > 8 * 1024) return false;
    storage.setItem(homeSummaryStorageKey(owner, region), value);
    return true;
  } catch { return false; }
}

export function writeHomeSummary(storage: Pick<Storage, "setItem"> & Partial<Pick<Storage, "getItem">>, owner: string, region: RegionId, updatedAt: number, presentation: HomeBalancesPresentation): boolean {
  if (!isSafeQueryIdentity(owner) || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > Date.now()) return false;
  const rates = storage.getItem ? readHomeRateLabels({ getItem: storage.getItem.bind(storage) }, owner, region) : undefined;
  const parsed = parseHomeSummaryRecord(JSON.stringify({ version: 1, owner, region, updatedAt, presentation, rates }), owner, region);
  if (!parsed) return false;
  try {
    const value = JSON.stringify(parsed);
    if (value.length > 8 * 1024) return false;
    storage.setItem(homeSummaryStorageKey(owner, region), value);
    return true;
  } catch { return false; }
}

export function syncHomeSummaryCookie(storage: Pick<Storage, "getItem">, owner: string, region: RegionId): void {
  if (typeof document === "undefined") return;
  const record = readRecord(storage, owner, region);
  writeHomeSummaryCookie(record);
}
