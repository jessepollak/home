import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { balanceStartupDetails } from "@/client/observability/balance-performance";
import { buildBalancesSnapshotFixture, walletHolding } from "@/shared/balances/fixtures";
import {
  clearOwnerQueryBoundary, clearOwnerQueryMemory, createHomeQueryClient, createOwnerQueryPersister,
  dehydrateOwnerQueries, ownerQueryKey, ownerQueryMeta, restoreOwnerQueriesAsync,
  ownerQueryStorageKey, ownerQueryCacheTtlMs,
} from "./query-client";

const snapshot = buildBalancesSnapshotFixture({ catalog: Array.from({ length: 14_000 }, (_, index) => walletHolding({
  address: `0x${(index + 100).toString(16).padStart(40, "0")}`,
  name: `Synthetic token ${index}`, symbol: "TOKEN", decimals: 18,
}, "1", { status: "unpriced", reason: "price-unavailable" })) });
const owner = dataOwnerKey({ subject: "synthetic-owner", smartAccountAddress: snapshot.owner.address, chainId: 8453 });
const key = ownerQueryKey(owner, "balances", "US");
const now = Date.parse("2026-10-01T00:00:00.000Z");
beforeEach(() => setSystemTime(new Date(now)));
afterEach(() => setSystemTime());

function quotaStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length * 2 > 5 * 1024 * 1024) throw new DOMException("Cache quota exceeded", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function persistedValue() {
  const client = createHomeQueryClient();
  client.setQueryDefaults(key, { meta: ownerQueryMeta(owner) });
  client.setQueryData(key, snapshot);
  const value = { timestamp: now, buster: "home-query-v4", clientState: dehydrateOwnerQueries(client, owner, now) };
  client.clear();
  return value;
}

describe("large owner cache", () => {
  test("restores every holding and unchanged partial totals under a small device quota", async () => {
    const storage = quotaStorage();
    const value = persistedValue();
    expect(() => storage.setItem("uncompressed", JSON.stringify(value))).toThrow("quota");
    const persister = createOwnerQueryPersister(storage, owner);
    persister?.persistClient(value);
    await persister?.flush();
    const restored = createHomeQueryClient();
    expect(await restoreOwnerQueriesAsync(restored, storage, owner, () => true)).toBe(true);
    const data = restored.getQueryData<typeof snapshot>(key);
    expect(data).toEqual(snapshot);
    expect(data && balanceStartupDetails(data).balanceCache).toBe("restored");
    restored.clear();
  });

  test("cannot persist late compression after cancellation or owner clear", async () => {
    for (const stop of ["cancel", "remove"] as const) {
      const storage = quotaStorage();
      const persister = createOwnerQueryPersister(storage, owner);
      persister?.persistClient(persistedValue());
      const write = persister?.flush();
      if (stop === "cancel") persister?.cancel();
      else persister?.removeClient();
      await write;
      expect(storage.length).toBe(0);
    }
  });

  test("a later write wins over pending older compression", async () => {
    const storage = quotaStorage();
    const persister = createOwnerQueryPersister(storage, owner);
    persister?.persistClient(persistedValue());
    const older = persister?.flush();
    const newer = { timestamp: now, buster: "home-query-v4", clientState: { queries: [], mutations: [] } };
    persister?.persistClient(newer);
    await persister?.flush();
    await older;
    expect(await persister?.restoreClientAsync()).toEqual(newer);
  });

  test("pending compression cannot overwrite another tab's newer write or cache removal", async () => {
    for (const next of ["write", "remove"] as const) {
      const storage = quotaStorage();
      const oldTab = createOwnerQueryPersister(storage, owner);
      const newTab = createOwnerQueryPersister(storage, owner);
      const newer = { timestamp: now + 1, buster: "home-query-v4", clientState: { queries: [], mutations: [] } };
      newTab?.persistClient(newer);
      await newTab?.flush();
      oldTab?.persistClient(persistedValue());
      const older = oldTab?.flush();
      if (next === "write") {
        newTab?.persistClient({ ...newer, timestamp: now + 2 });
        await newTab?.flush();
      } else newTab?.removeClient();
      await older;
      expect(await newTab?.restoreClientAsync()).toEqual(next === "write" ? { ...newer, timestamp: now + 2 } : undefined);
    }
  });

  test("persistence blocking telemetry excludes the asynchronous compression wait", async () => {
    const storage = quotaStorage();
    const value = persistedValue();
    let clock = 0;
    const timings: { start: number; duration: number }[] = [];
    const nowSpy = spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const timedStorage = { ...storage, setItem: (key: string, value: string) => {
        clock += 10;
        storage.setItem(key, value);
      } };
      const persister = createOwnerQueryPersister(timedStorage, owner, 250,
        (start, duration) => timings.push({ start, duration }));
      persister?.persistClient(() => { clock += 5; return value; });
      const writing = persister?.flush();
      clock = 10_000;
      await writing;
      expect(timings).toEqual([{ start: 0, duration: 5 }, { start: 10_000, duration: 10 }]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("a pending restore cannot hydrate after owner cancellation or a memory boundary clear", async () => {
    for (const stop of ["cancel", "memory", "boundary"] as const) {
      const storage = quotaStorage();
      const persister = createOwnerQueryPersister(storage, owner);
      persister?.persistClient(persistedValue());
      await persister?.flush();
      const restored = createHomeQueryClient();
      let current = true;
      const reading = restoreOwnerQueriesAsync(restored, storage, owner, () => current);
      if (stop === "cancel") current = false;
      else if (stop === "memory") clearOwnerQueryMemory(restored);
      else clearOwnerQueryBoundary(restored);
      expect(await reading).toBe(false);
      expect(restored.getQueryCache().getAll()).toHaveLength(0);
      restored.clear();
    }
  });

  test("a compressed cache for another owner is not accepted", async () => {
    const storage = quotaStorage();
    const persister = createOwnerQueryPersister(storage, "different-owner");
    persister?.persistClient(persistedValue());
    await persister?.flush();
    const restored = createHomeQueryClient();
    expect(await restoreOwnerQueriesAsync(restored, storage, "different-owner", () => true)).toBe(false);
    expect(restored.getQueryCache().getAll()).toHaveLength(0);
    restored.clear();
  });

  test("an expired pending restore cannot delete a newer persisted value", async () => {
    const storage = quotaStorage();
    const persister = createOwnerQueryPersister(storage, owner);
    persister?.persistClient({ ...persistedValue(), timestamp: now - ownerQueryCacheTtlMs - 1 });
    await persister?.flush();
    const restored = createHomeQueryClient();
    const reading = restoreOwnerQueriesAsync(restored, storage, owner, () => true);
    const newer = JSON.stringify({ timestamp: now, buster: "home-query-v4", clientState: { queries: [], mutations: [] } });
    const storageKey = ownerQueryStorageKey(owner);
    if (!storageKey) throw new Error("Fixture owner must have a storage key.");
    storage.setItem(storageKey, newer);
    expect(await reading).toBe(false);
    expect(storage.getItem(storageKey)).toBe(newer);
    restored.clear();
  });

  test("compressed restore does not overwrite fresher in-memory balances", async () => {
    const storage = quotaStorage();
    const persister = createOwnerQueryPersister(storage, owner);
    persister?.persistClient(persistedValue());
    await persister?.flush();
    const restored = createHomeQueryClient();
    const newer = buildBalancesSnapshotFixture();
    restored.setQueryData(key, newer, { updatedAt: now + 1 });
    expect(await restoreOwnerQueriesAsync(restored, storage, owner, () => true)).toBe(true);
    expect(restored.getQueryData<typeof snapshot>(key)).toBe(newer);
    restored.clear();
  });

  test("expired restore preserves a newer write between decode completion and hydration", async () => {
    const storage = quotaStorage();
    const persister = createOwnerQueryPersister(storage, owner);
    persister?.persistClient({ ...persistedValue(), timestamp: now - ownerQueryCacheTtlMs - 1 });
    await persister?.flush();
    const storageKey = ownerQueryStorageKey(owner);
    if (!storageKey) throw new Error("Fixture owner must have a storage key.");
    const newer = JSON.stringify({ timestamp: now, buster: "home-query-v4", clientState: { queries: [], mutations: [] } });
    let reads = 0;
    const concurrentStorage = { ...storage, getItem: (key: string) => {
      const value = storage.getItem(key);
      if (++reads === 2) queueMicrotask(() => storage.setItem(storageKey, newer));
      return value;
    } };
    const restored = createHomeQueryClient();
    expect(await restoreOwnerQueriesAsync(restored, concurrentStorage, owner, () => true)).toBe(false);
    expect(storage.getItem(storageKey)).toBe(newer);
    restored.clear();
  });
});
