import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { presentHomeBalances } from "@/shared/balances/present";
import { homeSummaryStorageKey, readHomeSummary, writeHomeSummary } from "./home-summary-cache";
import { ownerQueryCacheTtlMs } from "./query-client";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const ready = presentHomeBalances({ status: "ready", snapshot: balancesSnapshotFixture, error: null });
beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => setSystemTime());
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }

describe("Home summary cache", () => {
  test("stores a small existing presentation without full holdings", () => {
    const cache = storage();
    expect(writeHomeSummary(cache, "a", "US", NOW, ready)).toBe(true);
    const value = cache.getItem(homeSummaryStorageKey("a", "US"));
    expect(value?.length).toBeLessThan(2_048);
    expect(value).not.toContain("catalog");
    expect(value).not.toContain("holdings");
    expect(readHomeSummary(cache, "a", "US")).toEqual({ ...ready, cachedAt: NOW, revalidating: true });
    expect(readHomeSummary(cache, "b", "US")).toBeNull();
    expect(readHomeSummary(cache, "a", "GB")).toBeNull();
  });
  test("rejects swapped scope, expired, future, malformed and oversized values", () => {
    const cache = storage(); const key = homeSummaryStorageKey("a", "US");
    for (const fields of [{ owner: "b" }, { region: "GB" }, { updatedAt: NOW + 1 }, { updatedAt: NOW - ownerQueryCacheTtlMs - 1 }]) {
      cache.setItem(key, JSON.stringify({ version: 1, owner: "a", region: "US", updatedAt: NOW, presentation: ready, ...fields }));
      expect(readHomeSummary(cache, "a", "US")).toBeNull();
    }
    for (const value of ["bad JSON", "x".repeat(8193), JSON.stringify({ version: 1, presentation: {} })]) {
      cache.setItem(key, value); expect(readHomeSummary(cache, "a", "US")).toBeNull();
    }
  });
  test("preserves the country-choice recovery state", () => {
    const cache = storage();
    const presentation = { ...ready, needsCountry: true as const, totalStatus: "unavailable" as const, displayTotal: null };
    expect(writeHomeSummary(cache, "a", "US", NOW, presentation)).toBe(true);
    expect(readHomeSummary(cache, "a", "US")?.needsCountry).toBe(true);
  });
  test("loading, unavailable and rejected storage cannot produce a summary", () => {
    const cache = storage();
    for (const status of ["loading", "unavailable"] as const) expect(writeHomeSummary(cache, "a", "US", NOW, { ...ready, status })).toBe(false);
    expect(writeHomeSummary({ setItem: () => { throw new Error("denied"); } }, "a", "US", NOW, ready)).toBe(false);
    expect(readHomeSummary({ getItem: () => { throw new Error("denied"); } }, "a", "US")).toBeNull();
  });
});
