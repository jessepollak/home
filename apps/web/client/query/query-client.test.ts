import { afterEach, beforeEach, describe, expect, jest, mock, setSystemTime, spyOn, test } from "bun:test";
import { dehydrate, QueryObserver } from "@tanstack/react-query";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { anonymousCountryPreferenceKey, legacyCountryPreferenceKey } from "@/config/country-preference";
import {
  clearOwnerQueryBoundary,
  clearOwnerQueryMemory,
  createHomeQueryClient,
  createOwnerQueryPersister,
  dehydrateOwnerQueries,
  isSafeQueryIdentity,
  ownerQueryCachePrefix,
  ownerQueryKey,
  ownerQueryMeta,
  ownerQueryCacheTtlMs,
  ownerRestoreCacheState,
  restoreOwnerQueries,
  shouldPersistOwnerQuery,
  subscribeOwnerQueryPersistence,
} from "./query-client";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => setSystemTime());

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
  test("maps restore provenance without retaining the owner key", () => {
    expect(ownerRestoreCacheState("private-owner-key", true)).toBe("restored");
    expect(ownerRestoreCacheState("private-owner-key", false)).toBe("cold");
    expect(ownerRestoreCacheState(null, false)).toBe("unknown");
  });

  test("owner switch clears memory and every persisted owner store", () => {
    const client = createHomeQueryClient();
    const storage = memoryStorage();
    client.setQueryData(ownerQueryKey("owner-a", "balances", "US"), { total: "1" });
    storage.setItem(`${ownerQueryCachePrefix}owner-a`, "a");
    storage.setItem(`${ownerQueryCachePrefix}owner-b`, "b");
    storage.setItem(legacyCountryPreferenceKey, "US");
    storage.setItem(anonymousCountryPreferenceKey, "GB");

    clearOwnerQueryBoundary(client, storage);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-a`)).toBeNull();
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-b`)).toBeNull();
    expect(storage.getItem(legacyCountryPreferenceKey)).toBe("US");
    expect(storage.getItem(anonymousCountryPreferenceKey)).toBe("GB");
  });

  test("preserving one owner clears other memory and persisted stores", () => {
    const client = createHomeQueryClient();
    const storage = memoryStorage();
    client.setQueryData(ownerQueryKey("owner-a", "balances", "US"), { total: "1" });
    client.setQueryData(ownerQueryKey("owner-b", "balances", "US"), { total: "2" });
    const ownerAStorageKey = `${ownerQueryCachePrefix}${encodeURIComponent("owner-a")}`;
    const ownerBStorageKey = `${ownerQueryCachePrefix}${encodeURIComponent("owner-b")}`;
    storage.setItem(ownerAStorageKey, "a");
    storage.setItem(ownerBStorageKey, "b");

    clearOwnerQueryBoundary(client, storage, "owner-a");

    expect(client.getQueryData<{ total: string }>(ownerQueryKey("owner-a", "balances", "US")))
      .toEqual({ total: "1" });
    expect(client.getQueryData(ownerQueryKey("owner-b", "balances", "US"))).toBeUndefined();
    expect(storage.getItem(ownerAStorageKey)).toBe("a");
    expect(storage.getItem(ownerBStorageKey)).toBeNull();
  });

  test("persists the whole balances snapshot including catalog rows", () => {
    const ownerKey = "owner-a";
    const client = createHomeQueryClient();
    client.setQueryDefaults(ownerQueryKey(ownerKey, "balances", "US"), {
      meta: ownerQueryMeta(ownerKey, "owner"),
    });
    const snapshot = balancesSnapshotFixture;
    client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), snapshot);

    const state = dehydrateOwnerQueries(client, ownerKey);
    const storage = memoryStorage();
    const persister = createOwnerQueryPersister(storage, ownerKey);
    persister?.persistClient({ timestamp: NOW, buster: "home-query-v3", clientState: state });
    persister?.flush();
    const restored = createHomeQueryClient();

    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.state.data).toEqual(snapshot);
    expect(restoreOwnerQueries(restored, storage, ownerKey)).toBe(true);
    const restoredSnapshot = restored.getQueryData<typeof snapshot>(
      ownerQueryKey(ownerKey, "balances", "US"),
    );
    expect(restoredSnapshot).toEqual(snapshot);
    expect(restoredSnapshot?.holdings.filter((holding) => holding.source === "catalog"))
      .toHaveLength(3);
  });

  test("restores a matching owner's balances through seven days and rejects older cache", () => {
    const ownerKey = "owner-a";
    const storage = memoryStorage();
    const now = NOW;
    const client = createHomeQueryClient();
    client.setQueryDefaults(ownerQueryKey(ownerKey, "balances", "US"), {
      meta: ownerQueryMeta(ownerKey, "owner"),
    });
    client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture, {
      updatedAt: now - ownerQueryCacheTtlMs + 1,
    });
    const persister = createOwnerQueryPersister(storage, ownerKey)!;
    persister.persistClient({
      timestamp: now - ownerQueryCacheTtlMs + 1,
      buster: "home-query-v3",
      clientState: dehydrateOwnerQueries(client, ownerKey, now),
    });
    persister.flush();
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, ownerKey, now)).toBe(true);
    expect(restored.getQueryData<typeof balancesSnapshotFixture>(ownerQueryKey(ownerKey, "balances", "US")))
      .toEqual(balancesSnapshotFixture);
    expect(restoreOwnerQueries(createHomeQueryClient(), storage, ownerKey, now + 2)).toBe(false);
    expect(storage.getItem(`${ownerQueryCachePrefix}${ownerKey}`)).toBeNull();
  });

  test("a fresh snapshot cannot restore a balance older than seven days", () => {
    const ownerKey = "owner-a";
    const storage = memoryStorage();
    const now = NOW;
    const client = createHomeQueryClient();
    for (const scope of ["balances", "activity"] as const) {
      client.setQueryDefaults(ownerQueryKey(ownerKey, scope, "US"), {
        meta: ownerQueryMeta(ownerKey, "owner"),
      });
    }
    client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture, {
      updatedAt: now - ownerQueryCacheTtlMs + 1,
    });
    client.setQueryData(ownerQueryKey(ownerKey, "activity", "US"), { items: [] }, { updatedAt: now });
    const persister = createOwnerQueryPersister(storage, ownerKey)!;
    persister.persistClient({
      timestamp: now,
      buster: "home-query-v3",
      clientState: dehydrateOwnerQueries(client, ownerKey, now),
    });
    persister.flush();

    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, ownerKey, now + 2)).toBe(true);
    expect(restored.getQueryData(ownerQueryKey(ownerKey, "balances", "US"))).toBeUndefined();
    expect(restored.getQueryData<{ items: unknown[] }>(ownerQueryKey(ownerKey, "activity", "US")))
      .toEqual({ items: [] });
  });

  test("a throwing storage fails open", () => {
    const client = createHomeQueryClient();
    const storage = {
      getItem: () => { throw new Error("private mode"); },
      setItem: () => { throw new Error("quota exceeded"); },
      removeItem: () => {},
    };
    const persister = createOwnerQueryPersister(storage, "owner-a", 0);

    expect(() => {
      persister?.persistClient({ timestamp: NOW, buster: "home-query-v3", clientState: { mutations: [], queries: [] } });
      persister?.flush();
    }).not.toThrow();
    expect(restoreOwnerQueries(client, storage, "owner-a")).toBe(false);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  test("a tampered blob cannot hydrate another owner's queries", () => {
    const storage = memoryStorage();
    const attacker = createHomeQueryClient();
    attacker.setQueryDefaults(ownerQueryKey("owner-b", "balances", "US"), {
      meta: ownerQueryMeta("owner-b", "owner"),
    });
    attacker.setQueryData(ownerQueryKey("owner-b", "balances", "US"), { amount: "99" });
    storage.setItem(`${ownerQueryCachePrefix}owner-a`, JSON.stringify({
      timestamp: NOW,
      buster: "home-query-v3",
      clientState: dehydrateOwnerQueries(attacker, "owner-b"),
    }));

    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-a")).toBe(false);
    expect(restored.getQueryCache().getAll()).toHaveLength(0);
    expect(restored.getQueryData(ownerQueryKey("owner-b", "balances", "US"))).toBeUndefined();
  });

  test("persister restores synchronously and dehydration rejects non-owner keys", async () => {
    const storage = memoryStorage();
    expect(isSafeQueryIdentity("Bearer secret")).toBeFalse();
    expect(createOwnerQueryPersister(storage, "Bearer secret")).toBeNull();

    const ownerKey = "subject\u00000x1111111111111111111111111111111111111111\u00008453";
    const client = createHomeQueryClient();
    await client.fetchQuery({
      queryKey: ownerQueryKey(ownerKey, "balances", "US"),
      meta: ownerQueryMeta(ownerKey, "owner"),
      queryFn: async () => ({ amount: "10" }),
    });
    await client.fetchQuery({
      queryKey: ownerQueryKey("other-owner", "balances", "US"),
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
      timestamp: NOW,
      buster: "home-query-v3",
      clientState: dehydrated,
    });
    persister?.flush();
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, ownerKey)).toBe(true);
    expect(restored.getQueryData<{ amount: string }>(ownerQueryKey(ownerKey, "balances", "US")))
      .toEqual({ amount: "10" });
  });
});

describe("coalesced owner query persistence", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(ownerKey = "owner-a") {
    const client = createHomeQueryClient();
    const storage = memoryStorage();
    const key = ownerQueryKey(ownerKey, "balances", "US");
    client.setQueryDefaults(key, { meta: ownerQueryMeta(ownerKey) });
    const write = spyOn(storage, "setItem");
    const scan = spyOn(client.getQueryCache(), "getAll");
    const cancel = subscribeOwnerQueryPersistence(client, storage, ownerKey);
    return { client, storage, key, write, scan, cancel };
  }

  test("a burst scans and writes once after scheduling, with the latest whole snapshot", () => {
    const { client, key, storage, scan, write, cancel } = setup();
    for (let index = 0; index < 100; index += 1) client.setQueryData(key, { total: String(index) });
    expect(scan).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-a")).toBe(true);
    expect(restored.getQueryData<{ total: string }>(key)).toEqual({ total: "99" });
    cancel();
  });

  test("observer churn and fetch-only state do not scan or write", () => {
    const { client, key, scan, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    jest.advanceTimersByTime(1_000);
    scan.mockClear();
    write.mockClear();
    const observer = new QueryObserver(client, { queryKey: key, enabled: false, meta: ownerQueryMeta("owner-a") });
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions({ queryKey: key, enabled: false, meta: ownerQueryMeta("owner-a") });
    const query = client.getQueryCache().find({ queryKey: key })!;
    scan.mockClear();
    query.setState({ fetchStatus: "fetching" });
    query.setState({ fetchStatus: "idle" });
    unsubscribe();
    jest.advanceTimersByTime(1_000);
    expect(scan).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    cancel();
  });

  test("public, memory-only, and mismatched owner changes do not schedule snapshots", () => {
    const { client, scan, write, cancel } = setup();
    for (const [owner, persistence] of [["owner-a", "memory"], ["owner-b", "owner"], ["unauthenticated", "owner"]] as const) {
      const key = ownerQueryKey(owner, "activity");
      client.setQueryDefaults(key, { meta: ownerQueryMeta(owner, persistence) });
      client.setQueryData(key, { items: [] });
    }
    jest.advanceTimersByTime(1_000);
    expect(scan).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    cancel();
  });

  test.each(["remove", "error", "reset"] as const)("%s removes a formerly successful query from persistence", (transition) => {
    const { client, key, storage, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    jest.advanceTimersByTime(1_000);
    if (transition === "remove") client.removeQueries({ queryKey: key });
    else if (transition === "reset") client.getQueryCache().find({ queryKey: key })!.reset();
    else client.getQueryCache().find({ queryKey: key })!.setState({ status: "error", error: new Error("offline") });
    jest.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(restoreOwnerQueries(createHomeQueryClient(), storage, "owner-a")).toBe(false);
    cancel();
  });

  test("an invalidation is persisted without fabricating fresh data", () => {
    const { client, key, storage, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    void client.invalidateQueries({ queryKey: key, refetchType: "none" });
    jest.advanceTimersByTime(1_000);
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-a")).toBe(true);
    expect(restored.getQueryState(key)?.isInvalidated).toBe(true);
    expect(restored.getQueryData<{ total: string }>(key)).toEqual({ total: "1" });
    cancel();
  });

  test("a failed background read removes the errored query and later success restores persistence", async () => {
    const { client, key, storage, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    jest.advanceTimersByTime(1_000);
    await expect(client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      meta: ownerQueryMeta("owner-a"),
      queryFn: () => Promise.reject(new Error("offline")),
    })).rejects.toThrow("offline");
    jest.advanceTimersByTime(1_000);
    expect(client.getQueryData<{ total: string }>(key)).toEqual({ total: "1" });
    expect(restoreOwnerQueries(createHomeQueryClient(), storage, "owner-a")).toBe(false);
    client.setQueryData(key, { total: "2" });
    jest.advanceTimersByTime(1_000);
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-a")).toBe(true);
    expect(restored.getQueryData<{ total: string }>(key)).toEqual({ total: "2" });
    cancel();
  });

  test.each(["signout", "memory-only"] as const)("%s clearing cannot be undone by a pending timer", (boundary) => {
    const { client, key, storage, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    jest.advanceTimersByTime(1_000);
    const previous = storage.getItem(`${ownerQueryCachePrefix}owner-a`);
    client.setQueryData(key, { total: "2" });
    if (boundary === "signout") clearOwnerQueryBoundary(client, storage);
    else clearOwnerQueryMemory(client);
    jest.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-a`)).toBe(boundary === "signout" ? null : previous);
    cancel();
  });

  test("preserving the active owner keeps its pending snapshot subscribed", () => {
    const { client, key, storage, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    clearOwnerQueryBoundary(client, storage, "owner-a");
    jest.advanceTimersByTime(1_000);
    client.setQueryData(key, { total: "2" });
    jest.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(2);
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-a")).toBe(true);
    expect(restored.getQueryData<{ total: string }>(key)).toEqual({ total: "2" });
    cancel();
  });

  test.each(["full", "memory-only"] as const)("%s boundary resumes same-owner persistence without reviving queued or detached work", (boundary) => {
    const { client, key, storage, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    const detached = client.getQueryCache().find({ queryKey: key })!;
    if (boundary === "full") clearOwnerQueryBoundary(client, storage);
    else clearOwnerQueryMemory(client);
    detached.setData({ total: "stale" });
    jest.advanceTimersByTime(1_000);
    expect(write).not.toHaveBeenCalled();
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-a`)).toBeNull();
    client.setQueryData(key, { total: "2" });
    jest.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(1);
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-a")).toBe(true);
    expect(restored.getQueryData<{ total: string }>(key)).toEqual({ total: "2" });
    cancel();
  });

  test("cleanup discards queued snapshots and future cache events", () => {
    const { client, key, scan, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    cancel();
    client.setQueryData(key, { total: "2" });
    jest.advanceTimersByTime(1_000);
    expect(scan).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test("an owner boundary cancels old work before removals can resurrect its store", () => {
    const { client, key, storage, write, cancel } = setup();
    client.setQueryData(key, { total: "1" });
    clearOwnerQueryBoundary(client, storage, "owner-b");
    const otherKey = ownerQueryKey("owner-b", "balances", "US");
    client.setQueryDefaults(otherKey, { meta: ownerQueryMeta("owner-b") });
    const cancelOther = subscribeOwnerQueryPersistence(client, storage, "owner-b");
    client.setQueryData(otherKey, { total: "2" });
    jest.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`${ownerQueryCachePrefix}owner-a`)).toBeNull();
    const restored = createHomeQueryClient();
    expect(restoreOwnerQueries(restored, storage, "owner-b")).toBe(true);
    expect(restored.getQueryData<{ total: string }>(otherKey)).toEqual({ total: "2" });
    cancel();
    cancelOther();
  });

  test("lazy snapshots are not evaluated after cancellation and diagnostics fail open", () => {
    const snapshot = mock(() => ({ timestamp: NOW, buster: "home-query-v3", clientState: { mutations: [], queries: [] } }));
    const persister = createOwnerQueryPersister(memoryStorage(), "owner-a", 250, () => { throw new Error("diagnostics failed"); })!;
    persister.persistClient(snapshot);
    persister.cancel();
    jest.advanceTimersByTime(1_000);
    expect(snapshot).not.toHaveBeenCalled();
    persister.persistClient(snapshot);
    expect(() => jest.advanceTimersByTime(1_000)).not.toThrow();
    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});
