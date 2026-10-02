import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { clearOwnerQueryBoundary, getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { homeSummaryStorageKey, writeHomeSummary } from "@/client/query/home-summary-cache";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { presentHomeBalances, type HomeBalancesPresentation } from "@/shared/balances/present";
import type { RegionId } from "@/config/regions";
import { spyOn } from "bun:test";
import { writeHomeSummaryCookie } from "@/client/query/home-summary-cookie";
import { homeSummaryCookieName } from "@/shared/balances/home-summary";
import { renderToString } from "react-dom/server";
import { parseHomeSummaryRecord, type HomeSummaryRecord } from "@/shared/balances/home-summary";
import { useHomeSummary } from "./use-home-summary";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const loading: HomeBalancesPresentation = { status: "loading", displayTotal: null, breakdown: [], summary: null };
const ready = presentHomeBalances({ status: "ready", snapshot: balancesSnapshotFixture, error: null });
beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => { cleanup(); getHomeQueryClient().clear(); window.localStorage.clear(); setSystemTime(); });
function Display({ owner, region = "US", enabled = true, presentation = loading, updatedAt = 0, pending = false, initialSummary }: {
  owner: string | null; region?: RegionId; enabled?: boolean; presentation?: HomeBalancesPresentation; updatedAt?: number; pending?: boolean; initialSummary?: HomeSummaryRecord;
}) {
  const summary = useHomeSummary({ owner, region, enabled, presentation, updatedAt, pending, initialSummary });
  return <output data-cached-at={summary.cachedAt}>{summary.displayTotal ?? "loading"}</output>;
}
describe("Home summary startup", () => {
  test("paints before full hydration without fabricating an authoritative query", () => {
    writeHomeSummary(window.localStorage, "a", "US", NOW, ready);
    const view = render(<Display owner="a" />);
    expect(view.getByRole("status").textContent).toBe(ready.displayTotal ?? "");
    expect(getHomeQueryClient().getQueryCache().getAll()).toHaveLength(0);
    expect(view.getByRole("status").getAttribute("data-cached-at")).not.toBeNull();
  });
  test("owner, region and preference holds discard the old projection", () => {
    writeHomeSummary(window.localStorage, "a", "US", NOW, ready);
    const view = render(<Display owner="a" />);
    for (const props of [{ owner: "b" }, { owner: "a", region: "GB" as const }, { owner: "a", enabled: false }, { owner: null }]) {
      view.rerender(<Display {...props} />); expect(view.getByRole("status").textContent).toBe("loading");
    }
  });
  test("sign-out clears a displayed summary even when no full query was hydrated", () => {
    writeHomeSummary(window.localStorage, "a", "US", NOW, ready);
    const view = render(<Display owner="a" />);
    act(() => { clearOwnerQueryBoundary(getHomeQueryClient(), window.localStorage); });
    expect(view.getByRole("status").textContent).toBe("loading");
    expect(window.localStorage.getItem(homeSummaryStorageKey("a", "US"))).toBeNull();
  });
  test("invalidation discards durable data while refresh retains the previous display", () => {
    const client = getHomeQueryClient();
    client.setQueryData(ownerQueryKey("a", "balances", "US"), balancesSnapshotFixture);
    writeHomeSummary(window.localStorage, "a", "US", NOW, ready);
    const view = render(<Display owner="a" />);
    act(() => { void client.invalidateQueries({ queryKey: ownerQueryKey("a", "balances", "US") }); });
    expect(window.localStorage.getItem(homeSummaryStorageKey("a", "US"))).toBeNull();
    expect(view.getByRole("status").textContent).toBe(ready.displayTotal ?? "");
    act(() => { clearOwnerQueryBoundary(client, window.localStorage); });
    expect(view.getByRole("status").textContent).toBe("loading");
  });
  test("pending escrow holds the whole previous projection until reconciliation settles", () => {
    writeHomeSummary(window.localStorage, "a", "US", NOW - 1000, { ...ready, displayTotal: "$50.00" });
    const client = getHomeQueryClient(); client.setQueryData(ownerQueryKey("a", "balances", "US"), balancesSnapshotFixture);
    const updatedAt = client.getQueryState(ownerQueryKey("a", "balances", "US"))?.dataUpdatedAt ?? 0;
    const view = render(<Display owner="a" presentation={ready} updatedAt={updatedAt} pending />);
    expect(view.getByRole("status").textContent).toBe("$50.00");
    view.rerender(<Display owner="a" presentation={ready} updatedAt={updatedAt} />);
    expect(view.getByRole("status").textContent).toBe(ready.displayTotal ?? "");
    expect(view.getByRole("status").getAttribute("data-cached-at")).toBeNull();
  });
});

test("the first server HTML has the scoped summary, and clearing never revives its seed", () => {
  const initialSummary = parseHomeSummaryRecord(JSON.stringify({ version: 1, owner: "a", region: "US", updatedAt: NOW, presentation: ready }), "a", "US", NOW);
  if (!initialSummary || !ready.displayTotal) throw new Error("Summary fixture invalid");
  expect(renderToString(<Display owner="a" initialSummary={initialSummary} />)).toContain(ready.displayTotal);
  expect(renderToString(<Display owner="b" initialSummary={initialSummary} />)).toContain("loading");
  const view = render(<Display owner="a" initialSummary={initialSummary} />);
  expect(view.getByRole("status").textContent).toBe(ready.displayTotal);
  act(() => { clearOwnerQueryBoundary(getHomeQueryClient(), window.localStorage); });
  expect(view.getByRole("status").textContent).toBe("loading");
  view.rerender(<Display owner="b" initialSummary={initialSummary} />);
  view.rerender(<Display owner="a" initialSummary={initialSummary} />);
  expect(view.getByRole("status").textContent).toBe("loading");
});

test("invalidation clears the cookie even when local storage removal is denied", () => {
  window.history.replaceState(null, "", "/home");
  const initialSummary = parseHomeSummaryRecord(JSON.stringify({ version: 1, owner: "a", region: "US", updatedAt: NOW, presentation: ready }), "a", "US", NOW);
  if (!initialSummary || !ready.displayTotal) throw new Error("Summary fixture invalid");
  const client = getHomeQueryClient();
  client.setQueryData(ownerQueryKey("a", "balances", "US"), balancesSnapshotFixture);
  writeHomeSummaryCookie(initialSummary);
  const view = render(<Display owner="a" initialSummary={initialSummary} />);
  const remove = spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new Error("denied"); });
  try {
    act(() => { void client.invalidateQueries({ queryKey: ownerQueryKey("a", "balances", "US") }); });
    expect(document.cookie).not.toContain(homeSummaryCookieName);
    expect(view.getByRole("status").textContent).toBe(ready.displayTotal);
  } finally { remove.mockRestore(); window.history.replaceState(null, "", "/"); }
});
