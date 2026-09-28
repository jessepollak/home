import { describe, expect, test } from "bun:test";
import { createPairCheck } from "./pair-check";

const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const c = "0x3333333333333333333333333333333333333333";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("pair checks", () => {
  test("admits reads in FIFO order without exceeding the concurrency cap", async () => {
    const calls: string[] = [];
    const held: { address: string; release: () => void }[] = [];
    const firstTwo = deferred<void>();
    const nextTwo = deferred<void>();
    const last = deferred<void>();
    let active = 0;
    let observedMax = 0;
    const check = createPairCheck({ maxConcurrent: 2, cacheMaxEntries: 5, ttlMs: 1000, read: async (address) => {
      calls.push(address);
      active++;
      observedMax = Math.max(observedMax, active);
      if (calls.length === 2) firstTwo.resolve();
      if (calls.length === 4) nextTwo.resolve();
      if (calls.length === 5) last.resolve();
      const pending = deferred<boolean>();
      held.push({ address, release: () => { active--; pending.resolve(false); } });
      return pending.promise;
    } });
    const addresses = [a, b, c, "0x4444444444444444444444444444444444444444", "0x5555555555555555555555555555555555555555"] as `0x${string}`[];
    const results = addresses.map(check);
    await firstTwo.promise;
    expect(calls).toEqual([a, b]);
    held[0]!.release();
    held[1]!.release();
    await nextTwo.promise;
    expect(calls).toEqual(addresses.slice(0, 4));
    held[2]!.release();
    await last.promise;
    expect(calls).toEqual(addresses);
    held[3]!.release();
    held[4]!.release();
    expect(await Promise.all(results)).toEqual([false, false, false, false, false]);
    expect(active).toBe(0);
    expect(observedMax).toBe(2);
  });

  test("caches definitive true and false answers with lowercase address keys", async () => {
    let reads = 0;
    const check = createPairCheck({ maxConcurrent: 2, cacheMaxEntries: 2, ttlMs: 1000, read: async (address) => { reads++; return address.toLowerCase() === a; } });
    expect(await check(a)).toBe(true);
    expect(await check(`0x${a.slice(2).toUpperCase()}`)).toBe(true);
    expect(await check(b)).toBe(false);
    expect(await check(`0x${b.slice(2).toUpperCase()}`)).toBe(false);
    expect(reads).toBe(2);
  });

  test("does not cache inconclusive answers", async () => {
    let reads = 0;
    const check = createPairCheck({ maxConcurrent: 1, cacheMaxEntries: 1, ttlMs: 1000, read: async () => ++reads === 1 ? null : false });
    expect(await check(a)).toBeNull();
    expect(await check(a)).toBe(false);
    expect(reads).toBe(2);
  });

  test("coalesces simultaneous checks for the same address", async () => {
    const held = deferred<boolean>();
    let reads = 0;
    const check = createPairCheck({ maxConcurrent: 1, cacheMaxEntries: 1, ttlMs: 1000, read: async () => { reads++; return held.promise; } });
    const first = check(a);
    const second = check(`0x${a.slice(2).toUpperCase()}`);
    expect(reads).toBe(1);
    held.resolve(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(reads).toBe(1);
  });

  test("re-reads after the TTL expires", async () => {
    let time = 100;
    let reads = 0;
    const check = createPairCheck({ maxConcurrent: 1, cacheMaxEntries: 1, ttlMs: 50, now: () => time, read: async () => { reads++; return false; } });
    expect(await check(a)).toBe(false);
    time = 149;
    expect(await check(a)).toBe(false);
    time = 150;
    expect(await check(a)).toBe(false);
    expect(reads).toBe(2);
  });

  test("refreshes LRU on hit and evicts oldest when at capacity", async () => {
    const calls: string[] = [];
    const check = createPairCheck({ maxConcurrent: 1, cacheMaxEntries: 2, ttlMs: 1000, read: async (address) => { calls.push(address); return false; } });
    await check(a);
    await check(b);
    await check(a);
    await check(c);
    await check(a);
    await check(c);
    expect(calls).toEqual([a, b, c]);
    await check(b);
    expect(calls).toEqual([a, b, c, b]);
  });

  test("propagates read rejections and releases the slot for a waiting check", async () => {
    const failed = deferred<boolean>();
    const secondStarted = deferred<void>();
    let reads = 0;
    const check = createPairCheck({ maxConcurrent: 1, cacheMaxEntries: 1, ttlMs: 1000, read: async () => {
      reads++;
      if (reads === 1) return failed.promise;
      secondStarted.resolve();
      return false;
    } });
    const first = check(a);
    const second = check(b);
    expect(reads).toBe(1);
    failed.reject(new Error("RPC unavailable"));
    await expect(first).rejects.toThrow("RPC unavailable");
    await secondStarted.promise;
    expect(await second).toBe(false);
    expect(await check(a)).toBe(false);
    expect(reads).toBe(3);
  });
});
