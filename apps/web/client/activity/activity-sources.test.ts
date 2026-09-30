import { expect, test } from "bun:test";
import type { ActivityPage, ActivityState } from "./types";
import { activitySourcesAttribute, sourceReadiness, transfersReadiness } from "./activity-sources";

const ready = (nextCursor: string | null = null, overrides: { loadMoreError?: boolean; onchainStatus?: "unavailable"; latestUnavailable?: boolean } = {}): ActivityState => {
  const page: ActivityPage = {
    walletAddress: "0x1111111111111111111111111111111111111111", chainId: 8453,
    window: { from: "2026-08-15T12:00:00.000Z", to: "2026-09-15T12:00:00.000Z" },
    currency: "USD", transfers: [], nextCursor, source: null, onchainStatus: overrides.onchainStatus,
  };
  return { status: "ready", page, loadingMore: false, loadMoreError: overrides.loadMoreError === true, continuing: false, latestUnavailable: overrides.latestUnavailable };
};

test("source readiness uses the ordered Activity DOM contract", () => {
  expect(activitySourcesAttribute({ orders: "loading", actions: "ready", transfers: "ready" })).toBe("transfers:ready actions:ready orders:loading");
});

test("an actively fetching source stays loading whatever its last result", () => {
  expect(sourceReadiness("ready", true)).toBe("loading");
  expect(sourceReadiness("ready", false)).toBe("ready");
  expect(sourceReadiness("error", true)).toBe("loading");
  expect(sourceReadiness("ready", false, true)).toBe("error");
  expect(sourceReadiness("ready", true, true)).toBe("loading");
});

test("transfers stay loading before the initial page settles", () => {
  expect(transfersReadiness({ status: "loading", page: null, loadingMore: false, loadMoreError: false, continuing: false })).toBe("loading");
});

test("transfers stay loading while a cursor can extend the feed", () => {
  expect(transfersReadiness(ready("cursor-1"))).toBe("loading");
});

test("transfers are ready only after their cursor is exhausted", () => {
  expect(transfersReadiness(ready())).toBe("ready");
});

test("transfers stay loading during revalidation even after their cursor is exhausted", () => {
  expect(transfersReadiness({ ...ready(), refreshing: true })).toBe("loading");
  expect(transfersReadiness({ ...ready(), refreshing: false })).toBe("ready");
  expect(transfersReadiness({ ...ready("cursor-1"), refreshing: false })).toBe("loading");
  expect(transfersReadiness({ ...ready("cursor-1", { loadMoreError: true }), refreshing: false })).toBe("error");
  expect(transfersReadiness({ ...ready(null, { onchainStatus: "unavailable" }), refreshing: false })).toBe("unavailable");
});

test("a failed latest transfer read reports an error while cached rows remain ready", () => {
  expect(transfersReadiness({ ...ready(), failed: true })).toBe("error");
  expect(transfersReadiness({ ...ready("cursor-1"), failed: true })).toBe("error");
});

test("a failed latest window settles transfers with an error while cached rows remain", () => {
  expect(transfersReadiness(ready(null, { latestUnavailable: true }))).toBe("error");
  expect(transfersReadiness(ready("cursor-1", { latestUnavailable: true }))).toBe("error");
});

test("a failed continuation settles transfers with an error", () => {
  expect(transfersReadiness(ready("cursor-1", { loadMoreError: true }))).toBe("error");
});

test("an onchain-unavailable page settles transfers as unavailable", () => {
  expect(transfersReadiness(ready(null, { onchainStatus: "unavailable" }))).toBe("unavailable");
});

test("a failed initial page settles transfers with an error", () => {
  expect(transfersReadiness({ status: "error", page: null, loadingMore: false, loadMoreError: false, continuing: false, error: { code: "ACTIVITY_UPSTREAM", message: "Activity unavailable" } })).toBe("error");
});

test("a failed initial page stays loading while it is actively fetching", () => {
  expect(transfersReadiness({ status: "error", page: null, loadingMore: false, loadMoreError: false, continuing: false, refreshing: true, error: { code: "ACTIVITY_UPSTREAM", message: "Activity unavailable" } })).toBe("loading");
});

test("an unavailable activity state settles transfers as unavailable", () => {
  expect(transfersReadiness({ status: "unavailable", page: null, loadingMore: false, loadMoreError: false, continuing: false })).toBe("unavailable");
});
