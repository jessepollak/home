import { describe, expect, test } from "bun:test";
import { createRecentCache } from "./recent-cache";

describe("createRecentCache", () => {
  test("returns what it stored", () => {
    const cache = createRecentCache<string>(4);
    cache.set("a", "one");
    expect(cache.get("a")).toBe("one");
    expect(cache.get("b")).toBeUndefined();
  });

  test("drops the least recently used entry beyond the limit", () => {
    const cache = createRecentCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  test("keeps at most the limit across many sizes", () => {
    const cache = createRecentCache<number>(4);
    for (let size = 0; size < 50; size++) cache.set(`size-${size}`, size);
    const kept = Array.from({ length: 50 }, (_, size) => cache.get(`size-${size}`)).filter((value) => value !== undefined);
    expect(kept).toEqual([46, 47, 48, 49]);
  });
});
