import { writeHomeSummaryCookie } from "./home-summary-cookie";
import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import type { HomeBalancesPresentation } from "@/shared/balances/present";
import { isSafeQueryIdentity, ownerQueryStorageKey } from "./query-client";

import { parseHomeSummaryRecord, recentHomeRates, homeSummaryPresentation, type HomeRateLabels } from "@/shared/balances/home-summary";
export type { HomeRateLabels, HomeRateObservation } from "@/shared/balances/home-summary";

export function homeSummaryStorageKey(owner: string, region: RegionId, currency: FiatCurrencyCode | null): string {
  return `${ownerQueryStorageKey(owner)}:home-summary:${region}:${currency ?? "none"}`;
}

function readRecord(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, currency: FiatCurrencyCode | null, now = Date.now()) {
  if (!isSafeQueryIdentity(owner)) return null;
  try {
    const value = storage.getItem(homeSummaryStorageKey(owner, region, currency));
    return parseHomeSummaryRecord(value ?? undefined, owner, region, currency, now);
  } catch { return null; }
}

export function readHomeSummary(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, currency: FiatCurrencyCode | null, now = Date.now()): HomeBalancesPresentation | null {
  const record = readRecord(storage, owner, region, currency, now);
  return record ? homeSummaryPresentation(record) : null;
}

export function readHomeRateLabels(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, currency: FiatCurrencyCode | null, now = Date.now()): HomeRateLabels {
  return recentHomeRates(readRecord(storage, owner, region, currency, now)?.rates, now);
}

export function writeHomeRateLabels(storage: Pick<Storage, "getItem" | "setItem">, owner: string, region: RegionId, currency: FiatCurrencyCode | null, rates: HomeRateLabels): boolean {
  const record = readRecord(storage, owner, region, currency);
  if (!record) return false;
  const merged = { ...record.rates };
  for (const key of ["cash", "borrow"] as const) {
    const incoming = rates[key];
    if (!incoming || !Number.isFinite(incoming.updatedAt) || incoming.updatedAt < 0 || incoming.updatedAt > Date.now()) continue;
    if ((merged[key]?.updatedAt ?? 0) > incoming.updatedAt) continue;
    merged[key] = incoming;
  }
  const parsed = parseHomeSummaryRecord(JSON.stringify({ ...record, rates: merged }), owner, region, currency);
  if (!parsed) return false;
  try {
    const value = JSON.stringify(parsed);
    if (value.length > 8 * 1024) return false;
    storage.setItem(homeSummaryStorageKey(owner, region, currency), value);
    return true;
  } catch { return false; }
}

export function writeHomeSummary(storage: Pick<Storage, "setItem"> & Partial<Pick<Storage, "getItem">>, owner: string, region: RegionId, currency: FiatCurrencyCode | null, updatedAt: number, presentation: HomeBalancesPresentation): boolean {
  if (!isSafeQueryIdentity(owner) || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > Date.now()) return false;
  const rates = storage.getItem ? readHomeRateLabels({ getItem: storage.getItem.bind(storage) }, owner, region, currency) : undefined;
  const parsed = parseHomeSummaryRecord(JSON.stringify({ version: 5, owner, region, currency, updatedAt, presentation, rates }), owner, region, currency);
  if (!parsed) return false;
  try {
    const value = JSON.stringify(parsed);
    if (value.length > 8 * 1024) return false;
    storage.setItem(homeSummaryStorageKey(owner, region, currency), value);
    return true;
  } catch { return false; }
}

export function syncHomeSummaryCookie(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, currency: FiatCurrencyCode | null): void {
  if (typeof document === "undefined") return;
  const record = readRecord(storage, owner, region, currency);
  writeHomeSummaryCookie(record);
}
