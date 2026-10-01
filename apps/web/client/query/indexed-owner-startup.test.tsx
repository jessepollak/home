import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, jest, setSystemTime, spyOn, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { dataOwnerKey } from "@/client/account/owner-keys";
import * as indexedCache from "./indexed-owner-cache";
import { OwnerQueryPersistence, clearOwnerQueryMemory, dehydrateOwnerQueries, getHomeQueryClient, ownerQueryKey, ownerQueryMeta, ownerQueryStorageKey } from "./query-client";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const owner = dataOwnerKey({ subject: "subject-a", smartAccountAddress: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" });
const key = ownerQueryKey(owner, "balances", "US");
const frames = new Map<number, FrameRequestCallback>();
let sequence = 0;
let restoreFrames: () => void;
beforeEach(() => {
  setSystemTime(new Date(NOW));
  const request = spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => { frames.set(++sequence, callback); return sequence; });
  const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  restoreFrames = () => { request.mockRestore(); cancel.mockRestore(); };
});
afterEach(() => { cleanup(); frames.clear(); restoreFrames(); getHomeQueryClient().clear(); window.localStorage.clear(); jest.useRealTimers(); setSystemTime(); });
function nextFrame() { act(() => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0); }); }
function persisted() {
  const client = getHomeQueryClient();
  client.setQueryDefaults(key, { meta: ownerQueryMeta(owner) }); client.setQueryData(key, balancesSnapshotFixture);
  const value = JSON.stringify({ timestamp: NOW, buster: "home-query-v4", clientState: dehydrateOwnerQueries(client, owner, NOW) });
  client.clear(); return value;
}
function lease(value: string | null, write = async () => true) { return { value, isCurrent: async () => true, write, remove: async () => {} }; }

test("full restore waits for first paint and cancellation prevents a late hydrate", async () => {
  const value = persisted();
  let complete: (cache: ReturnType<typeof lease>) => void = () => {};
  const held = new Promise<ReturnType<typeof lease>>((resolve) => { complete = resolve; });
  const open = spyOn(indexedCache, "openIndexedOwnerCache").mockImplementation(() => held);
  try {
    const view = render(<OwnerQueryPersistence ownerKey={owner} />);
    expect(open).not.toHaveBeenCalled(); nextFrame(); expect(open).not.toHaveBeenCalled(); nextFrame(); expect(open).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { complete(lease(value)); await held; });
    expect(getHomeQueryClient().getQueryData(key)).toBeUndefined();
  } finally { open.mockRestore(); }
});

test("a memory boundary during deferred restore prevents hydration", async () => {
  jest.useFakeTimers();
  const write = jest.fn(async () => true);
  const value = persisted();
  let complete: (cache: ReturnType<typeof lease>) => void = () => {};
  const held = new Promise<ReturnType<typeof lease>>((resolve) => { complete = resolve; });
  const open = spyOn(indexedCache, "openIndexedOwnerCache").mockImplementation(() => held);
  try {
    render(<OwnerQueryPersistence ownerKey={owner} />); nextFrame(); nextFrame();
    act(() => clearOwnerQueryMemory(getHomeQueryClient()));
    await act(async () => { complete(lease(value, write)); await held; });
    expect(getHomeQueryClient().getQueryData(key)).toBeUndefined();
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(write).not.toHaveBeenCalled();
  } finally { open.mockRestore(); }
});

test("legacy migration retains localStorage until the IndexedDB write succeeds", async () => {
  const value = persisted(); const storageKey = ownerQueryStorageKey(owner);
  if (!storageKey) throw new Error("Missing owner key");
  window.localStorage.setItem(storageKey, value);
  let allow = false;
  const write = spyOn({ write: async () => allow }, "write");
  const open = spyOn(indexedCache, "openIndexedOwnerCache").mockResolvedValue(lease(null, write));
  try {
    jest.useFakeTimers();
    render(<OwnerQueryPersistence ownerKey={owner} />); nextFrame(); nextFrame();
    await waitFor(() => expect(getHomeQueryClient().getQueryData<typeof balancesSnapshotFixture>(key)).toEqual(balancesSnapshotFixture));
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(write).toHaveBeenCalled(); expect(window.localStorage.getItem(storageKey)).toBe(value);
    allow = true;
    act(() => { getHomeQueryClient().setQueryData(key, balancesSnapshotFixture); });
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  } finally { open.mockRestore(); write.mockRestore(); }
});

test("IndexedDB rejection restores the validated legacy fallback", async () => {
  const value = persisted(); const storageKey = ownerQueryStorageKey(owner);
  if (!storageKey) throw new Error("Missing owner key");
  window.localStorage.setItem(storageKey, value);
  const open = spyOn(indexedCache, "openIndexedOwnerCache").mockRejectedValue(new Error("storage denied"));
  try {
    render(<OwnerQueryPersistence ownerKey={owner} />); nextFrame(); nextFrame();
    await waitFor(() => expect(getHomeQueryClient().getQueryData<typeof balancesSnapshotFixture>(key)).toEqual(balancesSnapshotFixture));
  } finally { open.mockRestore(); }
});
