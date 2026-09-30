import "@/client/account/dom-test-harness";
import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { buildBalancesSnapshotFixture, priced, walletHolding } from "@/shared/balances/fixtures";
import type { BalancesSnapshot } from "@/shared/balances/types";
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
      const view = renderHook(({ snapshot, enabled }) => useInvestmentRows(snapshot, enabled), {
        initialProps: { snapshot: first.snapshot as BalancesSnapshot | null, enabled: false },
      });
      expect(view.result.current).toHaveLength(0);
      expect(first.reads()).toBe(0);
      view.rerender({ snapshot: first.snapshot, enabled: true });
      const rows = view.result.current;
      const initialReads = first.reads();
      expect(rows.length).toBeGreaterThanOrEqual(count);
      expect(initialReads).toBeGreaterThan(0);
      view.rerender({ snapshot: first.snapshot, enabled: false });
      view.rerender({ snapshot: first.snapshot, enabled: true });
      expect(view.result.current).toBe(rows);
      expect(first.reads()).toBe(initialReads);
      const refreshed = measuredSnapshot(count);
      view.rerender({ snapshot: first.snapshot, enabled: false });
      view.rerender({ snapshot: refreshed.snapshot, enabled: false });
      expect(view.result.current).toHaveLength(0);
      expect(refreshed.reads()).toBe(0);
      view.rerender({ snapshot: refreshed.snapshot, enabled: true });
      expect(view.result.current).not.toBe(rows);
      expect(refreshed.reads()).toBe(initialReads);
      expect(view.result.current).toEqual(rows);
      view.rerender({ snapshot: null, enabled: true });
      expect(view.result.current).toHaveLength(0);
    });
  }
  test("owner and region replacement cannot return the previous owner's rows", () => {
    const first = measuredSnapshot(100);
    const view = renderHook(({ snapshot }) => useInvestmentRows(snapshot, true), { initialProps: { snapshot: first.snapshot } });
    const before = view.result.current;
    const replacement = buildBalancesSnapshotFixture();
    replacement.owner = { ...replacement.owner, address: "0x9999999999999999999999999999999999999999" };
    replacement.region = "MX";
    view.rerender({ snapshot: replacement });
    expect(view.result.current).not.toBe(before);
    expect(view.result.current.some((row) => row.holding.symbol === "A99")).toBe(false);
  });
});
