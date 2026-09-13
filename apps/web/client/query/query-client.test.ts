import { describe, expect, test } from "bun:test";
import { dehydrate } from "@tanstack/react-query";
import {
  clearOwnerQueryBoundary,
  createHomeQueryClient,
  createOwnerQueryPersister,
  dehydrateOwnerQueries,
  isSafeQueryIdentity,
  ownerQueryCachePrefix,
  ownerQueryKey,
  ownerQueryMeta,
  restoreOwnerQueries,
  shouldPersistOwnerQuery,
} from "./query-client";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("owner query cache boundary", () => {
  test("owner switch clears memory and every persisted owner store", () => {
    const client = createHomeQueryClient();
    const storage = memoryStorage();
    client.setQueryData(ownerQueryKey("owner-a", "valuation", "US"), { total: "1" });
    storage.setItem(`${ownerQueryCachePrefix}owner-a`, "a");
    storage.setItem(`${ownerQueryCachePrefix}owner-b`, "b");
    storage.setItem("home.country.v1", "US");

    clearOwnerQueryBoundary(client, storage);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-a`)).toBeNull();
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-b`)).toBeNull();
    expect(storage.getItem("home.country.v1")).toBe("US");
  });

  test("preserving one owner clears other memory and persisted stores", () => {
    const client = createHomeQueryClient();
    const storage = memoryStorage();
    client.setQueryData(ownerQueryKey("owner-a", "valuation", "US"), { total: "1" });
    client.setQueryData(ownerQueryKey("owner-b", "valuation", "US"), { total: "2" });
    const ownerAStorageKey = `${ownerQueryCachePrefix}${encodeURIComponent("owner-a")}`;
    const ownerBStorageKey = `${ownerQueryCachePrefix}${encodeURIComponent("owner-b")}`;
    storage.setItem(ownerAStorageKey, "a");
    storage.setItem(ownerBStorageKey, "b");

    clearOwnerQueryBoundary(client, storage, "owner-a");

    expect(client.getQueryData<{ total: string }>(ownerQueryKey("owner-a", "valuation", "US")))
      .toEqual({ total: "1" });
    expect(client.getQueryData(ownerQueryKey("owner-b", "valuation", "US"))).toBeUndefined();
    expect(storage.getItem(ownerAStorageKey)).toBe("a");
    expect(storage.getItem(ownerBStorageKey)).toBeNull();
  });

  test("persists a valuation snapshot without recognized wallet catalog rows", () => {
    const ownerKey = "owner-a";
    const client = createHomeQueryClient();
    client.setQueryDefaults(ownerQueryKey(ownerKey, "valuation", "US"), {
      meta: ownerQueryMeta(ownerKey, "memory"),
    });
    client.setQueryData(ownerQueryKey(ownerKey, "valuation", "US"), {
      version: 2,
      total: { atoms: "1234", scale: 2 },
      recognized: { holdings: [{ id: "recognized-secret" }] },
    });

    const state = dehydrateOwnerQueries(client, ownerKey);

    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.state.data).toEqual({
      version: 2,
      total: { atoms: "1234", scale: 2 },
    });
  });

  test("persister restores synchronously and dehydration rejects non-owner keys", async () => {
    const storage = memoryStorage();
    expect(isSafeQueryIdentity("Bearer secret")).toBeFalse();
    expect(createOwnerQueryPersister(storage, "Bearer secret")).toBeNull();

    const ownerKey = "subject\u00000x1111111111111111111111111111111111111111\u00008453";
    const client = createHomeQueryClient();
    await client.fetchQuery({
      queryKey: ownerQueryKey(ownerKey, "valuation", "US"),
      meta: ownerQueryMeta(ownerKey, "owner"),
      queryFn: async () => ({ amount: "10" }),
    });
    await client.fetchQuery({
      queryKey: ownerQueryKey("other-owner", "valuation", "US"),
      meta: ownerQueryMeta(ownerKey, "owner"),
      queryFn: async () => ({ amount: "99" }),
    });
    const dehydrated = dehydrate(client, {
      shouldDehydrateQuery: (query) => shouldPersistOwnerQuery(query, ownerKey),
    });
    expect(dehydrated.queries).toHaveLength(1);
    expect(dehydrated.queries[0]?.queryKey[0]).toBe(ownerKey);

    const persister = createOwnerQueryPersister(storage, ownerKey);
    persister?.persistClient({
      timestamp: Date.now(),
      buster: "home-query-v1",
      clientState: dehydrated,
    });
    persister?.flush();
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, ownerKey)).toBe(true);
    expect(restored.getQueryData<{ amount: string }>(ownerQueryKey(ownerKey, "valuation", "US")))
      .toEqual({ amount: "10" });
  });
});
