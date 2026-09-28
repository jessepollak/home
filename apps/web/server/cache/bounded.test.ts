import { describe, expect, test } from "bun:test";
import { createBoundedCache } from "./bounded";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const options = { maxEntries: 2, ttlMs: 10, maxInFlight: 2 };

describe("bounded server cache", () => {
  test("evicts the least recently used value after get and fetch hits", async () => {
    const cache = createBoundedCache<string>(options);
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");
    expect(cache.get("b")).toBeUndefined();
    expect(await cache.fetch("a", async () => "unexpected")).toEqual({ status: "hit", value: "A" });
    cache.set("d", "D");
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.size).toBe(2);
  });

  test("expires only after the TTL boundary, without extending age on hits, and reloads", async () => {
    let time = 0;
    let calls = 0;
    const cache = createBoundedCache<string>({ ...options, now: () => time });
    expect(await cache.fetch("a", async () => { calls++; return "first"; })).toEqual({ status: "loaded", value: "first" });
    time = 9;
    expect(cache.get("a")).toBe("first");
    time = 10;
    expect(await cache.fetch("a", async () => "unexpected")).toEqual({ status: "hit", value: "first" });
    time = 11;
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(await cache.fetch("a", async () => { calls++; return "second"; })).toEqual({ status: "loaded", value: "second" });
    expect(calls).toBe(2);
  });

  test("shares a pending load and releases its slot on success", async () => {
    const cache = createBoundedCache<string>(options);
    const task = deferred<string>();
    let calls = 0;
    const first = cache.fetch("a", () => { calls++; return task.promise; });
    const joined = cache.fetch("a", () => { calls++; return Promise.resolve("unexpected"); });
    expect(calls).toBe(1);
    expect(first).toBe(joined);
    expect(cache.size).toBe(0);
    expect(cache.inFlight).toBe(1);
    task.resolve("A");
    expect(await Promise.all([first, joined])).toEqual([
      { status: "loaded", value: "A" },
      { status: "loaded", value: "A" },
    ]);
    expect(cache.inFlight).toBe(0);
    expect(cache.get("a")).toBe("A");
  });

  test("rejects all joiners with the same error, leaves no value, and retries", async () => {
    const cache = createBoundedCache<string>({ ...options, maxInFlight: 1 });
    const task = deferred<string>();
    const error = new Error("failed");
    const first = cache.fetch("a", () => task.promise);
    const joined = cache.fetch("a", () => Promise.resolve("unexpected"));
    task.reject(error);
    const outcomes = await Promise.allSettled([first, joined]);
    expect(outcomes).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ]);
    expect(cache.inFlight).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(await cache.fetch("a", async () => "recovered")).toEqual({ status: "loaded", value: "recovered" });
  });

  test("synchronous load failures reject without consuming a slot", async () => {
    const cache = createBoundedCache<string>({ ...options, maxInFlight: 1 });
    const failure = new Error("sync failure");
    await expect(cache.fetch("a", () => { throw failure; })).rejects.toBe(failure);
    expect(cache.inFlight).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(await cache.fetch("a", async () => "recovered")).toEqual({ status: "loaded", value: "recovered" });
  });

  test("saturates at global and per-call limits but allows pending-key joiners", async () => {
    const cache = createBoundedCache<string>(options);
    const firstTask = deferred<string>();
    const secondTask = deferred<string>();
    const first = cache.fetch("a", () => firstTask.promise);
    let blockedCalls = 0;
    expect(await cache.fetch("b", () => { blockedCalls++; return Promise.resolve("B"); }, { capacity: 1 })).toEqual({ status: "saturated" });
    expect(await cache.fetch("b", () => { blockedCalls++; return Promise.resolve("B"); }, { capacity: -1 })).toEqual({ status: "saturated" });
    expect(await cache.fetch("b", () => { blockedCalls++; return Promise.resolve("B"); }, { capacity: NaN })).toEqual({ status: "saturated" });
    const second = cache.fetch("b", () => secondTask.promise);
    expect(await cache.fetch("c", () => { blockedCalls++; return Promise.resolve("C"); })).toEqual({ status: "saturated" });
    expect(cache.fetch("a", () => { blockedCalls++; return Promise.resolve("unexpected"); }, { capacity: 0 })).toBe(first);
    expect(blockedCalls).toBe(0);
    firstTask.resolve("A");
    expect(await first).toEqual({ status: "loaded", value: "A" });
    expect(cache.inFlight).toBe(1);
    expect(await cache.fetch("c", async () => "C")).toEqual({ status: "loaded", value: "C" });
    secondTask.resolve("B");
    expect(await second).toEqual({ status: "loaded", value: "B" });
    expect(cache.inFlight).toBe(0);
  });

  test("keeps singleflight without storing values when maxEntries is zero", async () => {
    const cache = createBoundedCache<string>({ ...options, maxEntries: 0 });
    const task = deferred<string>();
    const first = cache.fetch("a", () => task.promise);
    expect(cache.fetch("a", async () => "unexpected")).toBe(first);
    task.resolve("A");
    expect(await first).toEqual({ status: "loaded", value: "A" });
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(await cache.fetch("a", async () => "B")).toEqual({ status: "loaded", value: "B" });
    cache.set("a", "C");
    expect(cache.get("a")).toBeUndefined();
  });

  test("delete invalidates only its own flight", async () => {
    const cache = createBoundedCache<string>(options);
    const deleted = deferred<string>();
    const retained = deferred<string>();
    const first = cache.fetch("a", () => deleted.promise);
    const second = cache.fetch("b", () => retained.promise);
    cache.delete("a");
    deleted.resolve("A");
    retained.resolve("B");
    expect(await first).toEqual({ status: "loaded", value: "A" });
    expect(await second).toEqual({ status: "loaded", value: "B" });
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
  });

  test("clear invalidates every pending flight", async () => {
    const cache = createBoundedCache<string>(options);
    const clearing = deferred<string>();
    const third = cache.fetch("c", () => clearing.promise);
    cache.clear();
    clearing.resolve("C");
    expect(await third).toEqual({ status: "loaded", value: "C" });
    expect(cache.size).toBe(0);
    expect(cache.get("c")).toBeUndefined();
  });

  test("a fetch after invalidation starts fresh work while the stale flight still holds its slot", async () => {
    const cache = createBoundedCache<string>({ ...options, maxInFlight: 2 });
    const stale = deferred<string>();
    const fresh = deferred<string>();
    const first = cache.fetch("a", () => stale.promise);
    cache.delete("a");
    const second = cache.fetch("a", () => fresh.promise);
    expect(second).not.toBe(first);
    expect(cache.inFlight).toBe(2);
    expect(await cache.fetch("b", async () => "B")).toEqual({ status: "saturated" });
    fresh.resolve("fresh");
    expect(await second).toEqual({ status: "loaded", value: "fresh" });
    stale.resolve("stale");
    expect(await first).toEqual({ status: "loaded", value: "stale" });
    expect(cache.get("a")).toBe("fresh");
    expect(cache.inFlight).toBe(0);
  });

  test("a direct set during a flight wins over the late loaded value", async () => {
    const cache = createBoundedCache<string>(options);
    const task = deferred<string>();
    const pending = cache.fetch("a", () => task.promise);
    cache.set("a", "newer");
    task.resolve("late");
    expect(await pending).toEqual({ status: "loaded", value: "late" });
    expect(cache.get("a")).toBe("newer");
  });

  test("expired entries are purged before insertion so live entries keep their slots", () => {
    let time = 0;
    const cache = createBoundedCache<string>({ ...options, now: () => time });
    cache.set("a", "A");
    time = 2;
    cache.set("b", "B");
    time = 5;
    expect(cache.get("a")).toBe("A");
    time = 11;
    cache.set("c", "C");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
  });

  test("a loader that re-enters fetch sees its own slot and pending key", async () => {
    const cache = createBoundedCache<string>({ ...options, maxInFlight: 1 });
    const task = deferred<string>();
    let nested: Promise<unknown> | undefined;
    let sameKey: Promise<unknown> | undefined;
    let calls = 0;
    const outer = cache.fetch("a", () => {
      calls++;
      nested = cache.fetch("b", async () => { calls++; return "B"; });
      sameKey = cache.fetch("a", async () => { calls++; return "unexpected"; });
      return task.promise;
    });
    expect(await nested).toEqual({ status: "saturated" });
    expect(sameKey).toBe(outer);
    expect(cache.inFlight).toBe(1);
    task.resolve("A");
    expect(await outer).toEqual({ status: "loaded", value: "A" });
    expect(calls).toBe(1);
    expect(cache.inFlight).toBe(0);
  });

  test("a value the retain predicate rejects reaches every joiner without being stored or evicting live entries", async () => {
    const cache = createBoundedCache<string>({ ...options, maxEntries: 1, retain: (value) => value !== "error" });
    cache.set("live", "LIVE");
    const task = deferred<string>();
    let calls = 0;
    const first = cache.fetch("a", () => { calls++; return task.promise; });
    const joined = cache.fetch("a", () => { calls++; return Promise.resolve("unexpected"); });
    task.resolve("error");
    expect(await Promise.all([first, joined])).toEqual([
      { status: "loaded", value: "error" },
      { status: "loaded", value: "error" },
    ]);
    expect(calls).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("live")).toBe("LIVE");
    expect(cache.inFlight).toBe(0);
    expect(await cache.fetch("a", async () => "ok")).toEqual({ status: "loaded", value: "ok" });
    expect(cache.get("a")).toBe("ok");
  });

  test("invalid options fail fast", () => {
    for (const maxEntries of [-1, 1.5, NaN, Infinity]) {
      expect(() => createBoundedCache({ ...options, maxEntries })).toThrow();
    }
    for (const ttlMs of [0, -1, 0.5, NaN, Infinity]) {
      expect(() => createBoundedCache({ ...options, ttlMs })).toThrow();
    }
    for (const maxInFlight of [0, -1, 1.5, Infinity]) {
      expect(() => createBoundedCache({ ...options, maxInFlight })).toThrow();
    }
  });
});
