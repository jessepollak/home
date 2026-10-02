import "@/client/account/dom-test-harness";
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { clearOwnerQueryBoundary, getHomeQueryClient } from "@/client/query/query-client";
import { readHomeRateLabels, writeHomeRateLabels, writeHomeSummary, type HomeRateObservation } from "@/client/query/home-summary-cache";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { presentHomeBalances } from "@/shared/balances/present";
import type { RegionId } from "@/config/regions";
import { useHomeRateLabels } from "./use-home-rate-labels";
const now = Date.parse("2026-10-01T08:00:00.000Z");
const pending = { pending: true, value: null, updatedAt: 0 };
const ready = presentHomeBalances({ status: "ready", snapshot: balancesSnapshotFixture, error: null });
function seed() {
  setSystemTime(new Date(now));
  writeHomeSummary(window.localStorage, "a", "US", now, ready);
  writeHomeRateLabels(window.localStorage, "a", "US", { cash: { value: "4.41% APY", updatedAt: now }, borrow: { value: "4.81% APR", updatedAt: now } });
}
function Display({ owner = "a", region = "US", cash = pending, borrow = pending }: { owner?: string | null; region?: RegionId; cash?: HomeRateObservation; borrow?: HomeRateObservation }) {
  const labels = useHomeRateLabels({ owner, region, cash, borrow });
  return <output>{labels.cash ?? "unknown"} | {labels.borrow ?? "unknown"}</output>;
}
afterEach(() => { cleanup(); getHomeQueryClient().clear(); window.localStorage.clear(); setSystemTime(); });
test("cached subtitles survive independent loading and settle once, including unavailable", () => {
  seed();
  const view = render(<Display />);
  expect(view.container.textContent).toBe("4.41% APY | 4.81% APR");
  view.rerender(<Display cash={{ pending: false, value: "4.42% APY", updatedAt: now }} />);
  expect(view.container.textContent).toBe("4.42% APY | 4.81% APR");
  view.rerender(<Display borrow={{ pending: false, value: null, updatedAt: now }} />);
  expect(view.container.textContent).toBe("4.42% APY | unknown");
  expect(readHomeRateLabels(window.localStorage, "a", "US").borrow?.value).toBeNull();
  expect(getHomeQueryClient().getQueryCache().getAll()).toHaveLength(0);
});
test("owner, country and sign-out fences never retain another scope's subtitle", () => {
  seed();
  const view = render(<Display />);
  for (const props of [{ owner: "b" }, { owner: "a", region: "GB" as const }, { owner: null }]) {
    view.rerender(<Display {...props} />);
    expect(view.container.textContent).toBe("unknown | unknown");
  }
  view.rerender(<Display />);
  expect(view.container.textContent).toBe("4.41% APY | 4.81% APR");
  act(() => { clearOwnerQueryBoundary(getHomeQueryClient(), window.localStorage); });
  view.rerender(<Display cash={{ pending: false, value: "9.00% APY", updatedAt: now }} />);
  expect(view.container.textContent).toBe("unknown | unknown");
  expect(readHomeRateLabels(window.localStorage, "a", "US")).toEqual({});
});
test("expired labels restore no financial claim", () => {
  seed();
  setSystemTime(new Date(now + 6 * 60_000));
  const view = render(<Display />);
  expect(view.container.textContent).toBe("unknown | unknown");
});
