import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { buildBalancesSnapshotFixture, priced, walletHolding } from "@/shared/balances/fixtures";
import type { BalancesSnapshot } from "@/shared/balances/types";
const queued: (() => void)[] = [];
const originalChannel = globalThis.MessageChannel;
beforeEach(() => {
  globalThis.MessageChannel = class extends originalChannel {
    constructor() {
      super();
      this.port2.postMessage = () => queued.push(() => this.port1.onmessage?.(new MessageEvent("message")));
    }
  };
});
afterEach(() => { globalThis.MessageChannel = originalChannel; queued.length = 0; });
function nextSelection() {
  const next = queued.shift();
  if (!next) throw new Error("Missing queued investment selection");
  next();
}
function finishSelection() { act(() => { while (queued.length) nextSelection(); }); }
const { useInvestmentRows } = await import("./investments-experience");

function measuredSnapshot(count: number) {
  const snapshot = buildBalancesSnapshotFixture({ catalog: Array.from({ length: count }, (_, index) => walletHolding({
    address: `0x${(index + 100).toString(16).padStart(40, "0")}`, name: `Asset ${index}`, symbol: `A${index}`, decimals: 18,
  }, "1000000000000000000", priced("USD", String(index + 1)))) });
  let reads = 0;
  for (const holding of snapshot.holdings) {
    const value = holding.value;
    Object.defineProperty(holding, "value", { get: () => { reads++; return value; } });
  }
  return { snapshot, reads: () => reads };
}

describe("owned investment navigation work", () => {
  for (const count of [100, 1000, 10000]) {
    test(`${count} holdings: defer deep-link sorting, reuse Back rows, invalidate refreshed and removed snapshots`, () => {
      const first = measuredSnapshot(count);
      const initialProps: { snapshot: BalancesSnapshot | null; enabled: boolean } = { snapshot: first.snapshot, enabled: false };
      const view = renderHook(({ snapshot, enabled }) => useInvestmentRows(snapshot, enabled), {
        initialProps,
      });
      expect(view.result.current.rows).toHaveLength(0);
      expect(first.reads()).toBe(0);
      view.rerender({ snapshot: first.snapshot, enabled: true });
      expect(first.reads()).toBe(0);
      finishSelection();
      const rows = view.result.current.rows;
      const initialReads = first.reads();
      expect(rows.length).toBeGreaterThanOrEqual(count);
      expect(initialReads).toBeGreaterThan(0);
      view.rerender({ snapshot: first.snapshot, enabled: false });
      view.rerender({ snapshot: first.snapshot, enabled: true });
      expect(view.result.current.rows).toBe(rows);
      expect(first.reads()).toBe(initialReads);
      const refreshed = measuredSnapshot(count);
      view.rerender({ snapshot: first.snapshot, enabled: false });
      view.rerender({ snapshot: refreshed.snapshot, enabled: false });
      expect(view.result.current.rows).toHaveLength(0);
      expect(refreshed.reads()).toBe(0);
      view.rerender({ snapshot: refreshed.snapshot, enabled: true });
      finishSelection();
      expect(view.result.current.rows).not.toBe(rows);
      expect(refreshed.reads()).toBe(initialReads);
      expect(view.result.current.rows).toEqual(rows);
      view.rerender({ snapshot: null, enabled: true });
      expect(view.result.current.rows).toHaveLength(0);
    });
  }
  test("owner and region replacement cannot return the previous owner's rows", () => {
    const first = measuredSnapshot(100);
    const view = renderHook(({ snapshot }) => useInvestmentRows(snapshot, true), { initialProps: { snapshot: first.snapshot } });
    finishSelection();
    const before = view.result.current.rows;
    const replacement = buildBalancesSnapshotFixture();
    replacement.owner = { ...replacement.owner, address: "0x9999999999999999999999999999999999999999" };
    replacement.region = "MX";
    view.rerender({ snapshot: replacement });
    expect(view.result.current.rows).toHaveLength(0);
    finishSelection();
    expect(view.result.current.rows).not.toBe(before);
    expect(view.result.current.rows.some((row) => row.holding.symbol === "A99")).toBe(false);
  });
});

test("an interrupted job cannot publish or continue valuing a replaced owner", () => {
  let tick = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => tick++);
  try {
    const old = measuredSnapshot(10000);
    const replacement = measuredSnapshot(100);
    const view = renderHook(({ snapshot, enabled }) => useInvestmentRows(snapshot, enabled), {
      initialProps: { snapshot: old.snapshot, enabled: true },
    });
    act(nextSelection);
    view.rerender({ snapshot: replacement.snapshot, enabled: true });
    const oldReads = old.reads();
    expect(view.result.current.rows).toHaveLength(0);
    finishSelection();
    expect(old.reads()).toBe(oldReads);
    expect(view.result.current.rows).toHaveLength(100);
    expect(view.result.current.pending).toBe(false);
    view.rerender({ snapshot: old.snapshot, enabled: true });
    view.rerender({ snapshot: old.snapshot, enabled: false });
    const readsBeforeDetail = old.reads();
    finishSelection();
    expect(old.reads()).toBe(readsBeforeDetail);
    expect(view.result.current.rows).toHaveLength(0);
  } finally { clock.mockRestore(); }
});

test("selection failure stays unavailable and retry recomputes the same snapshot", () => {
  const fixture = measuredSnapshot(100);
  const holding = fixture.snapshot.holdings.find((entry) => entry.symbol === "A0");
  if (!holding) throw new Error("Missing failing-selection fixture holding");
  const balance = holding.balance;
  let broken = true;
  Object.defineProperty(holding, "balance", { get: () => { if (broken) throw new Error("selection failed"); return balance; } });
  const view = renderHook(() => useInvestmentRows(fixture.snapshot, true));
  finishSelection();
  expect(view.result.current.failed).toBe(true);
  expect(view.result.current.rows).toHaveLength(0);
  broken = false;
  act(() => view.result.current.retry());
  expect(view.result.current.pending).toBe(true);
  finishSelection();
  expect(view.result.current.failed).toBe(false);
  expect(view.result.current.rows).toHaveLength(100);
});
