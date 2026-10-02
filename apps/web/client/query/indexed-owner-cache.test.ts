import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { indexedDB as fixtureIndexedDB } from "fake-indexeddb";
import { createStore } from "idb-keyval";
import { clearIndexedOwnerCache, openIndexedOwnerCache } from "./indexed-owner-cache";

let descriptor: PropertyDescriptor | undefined;
beforeEach(() => { descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fixtureIndexedDB }); });
afterEach(() => { if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor); else Reflect.deleteProperty(globalThis, "indexedDB"); });
const database = () => createStore(crypto.randomUUID(), "owners");

describe("IndexedDB owner leases", () => {
  test("preserves large complete values only for the matching owner", async () => {
    const store = database();
    const a = await openIndexedOwnerCache("a", store);
    const value = "opaque-cache".repeat(600_000);
    expect(await a.write(value, 1, () => true)).toBe(true);
    expect((await openIndexedOwnerCache("a", store)).value).toBe(value);
    expect((await openIndexedOwnerCache("b", store)).value).toBeNull();
  });
  test("sign-out revokes a pending writer atomically", async () => {
    const store = database();
    const old = await openIndexedOwnerCache("a", store);
    await clearIndexedOwnerCache(undefined, store);
    expect(await old.write("late", 10, () => true)).toBe(false);
    expect((await openIndexedOwnerCache("a", store)).value).toBeNull();
  });
  test("A→B→A cannot reuse the first A's lease", async () => {
    const store = database();
    const old = await openIndexedOwnerCache("a", store);
    await old.write("a", 1, () => true);
    await clearIndexedOwnerCache("b", store);
    await (await openIndexedOwnerCache("b", store)).write("b", 2, () => true);
    await clearIndexedOwnerCache("a", store);
    await (await openIndexedOwnerCache("a", store)).write("new-a", 3, () => true);
    expect(await old.write("old-a", 4, () => true)).toBe(false);
    expect((await openIndexedOwnerCache("a", store)).value).toBe("new-a");
  });
  test("preservation, cancellation and newer timestamps fence writes", async () => {
    const store = database();
    const lease = await openIndexedOwnerCache("a", store);
    await lease.write("newer", 10, () => true);
    await clearIndexedOwnerCache("a", store);
    expect(await lease.write("older", 9, () => true)).toBe(false);
    expect(await lease.write("cancelled", 11, () => false)).toBe(false);
    expect((await openIndexedOwnerCache("a", store)).value).toBe("newer");
  });
  test("storage rejection does not block clearing the UI boundary", async () => {
    expect(await clearIndexedOwnerCache(undefined, () => Promise.reject(new Error("denied")))).toBe(false);
  });
});
