import "@/client/account/dom-test-harness";
import { afterEach, expect, test } from "bun:test";
import { presentHomeBalances } from "@/shared/balances/present";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { homeSummaryCookieName, parseHomeSummaryRecord } from "@/shared/balances/home-summary";
import { clearOwnerQueryBoundary, getHomeQueryClient } from "./query-client";
import { clearHomeSummaryCookie, writeHomeSummaryCookie } from "./home-summary-cookie";

const now = Date.parse("2026-10-02T05:00:00.000Z");
const record = parseHomeSummaryRecord(JSON.stringify({ version: 1, owner: "a", region: "US", updatedAt: now,
  presentation: presentHomeBalances({ status: "ready", snapshot: balancesSnapshotFixture, error: null }) }), "a", "US", now);
if (!record) throw new Error("Summary fixture invalid");
afterEach(() => { clearHomeSummaryCookie(); window.history.replaceState(null, "", "/"); });

test("the first-paint cookie is confined to Home and sign-out clears it from another route", () => {
  window.history.replaceState(null, "", "/home");
  expect(writeHomeSummaryCookie(record)).toBe(true);
  expect(document.cookie).toContain(homeSummaryCookieName);
  clearOwnerQueryBoundary(getHomeQueryClient(), window.localStorage, "a");
  expect(document.cookie).toContain(homeSummaryCookieName);
  window.history.replaceState(null, "", "/invest");
  expect(document.cookie).not.toContain(homeSummaryCookieName);
  clearOwnerQueryBoundary(getHomeQueryClient(), window.localStorage);
  window.history.replaceState(null, "", "/home");
  expect(document.cookie).not.toContain(homeSummaryCookieName);
});

test("a refused cookie write or clear stays a best-effort failure", () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, "cookie");
  Object.defineProperty(document, "cookie", { configurable: true, set: () => { throw new Error("denied"); }, get: () => "" });
  try {
    expect(writeHomeSummaryCookie(record)).toBe(false);
    expect(clearHomeSummaryCookie()).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(document, "cookie", descriptor);
    else Reflect.deleteProperty(document, "cookie");
  }
});
