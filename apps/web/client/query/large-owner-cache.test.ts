import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
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
    expect(restored.getQueryData(key)).toBe(newer);
    restored.clear();
  });
});
