import { describe, expect, test } from "bun:test";
import { presentHomeBalances } from "./present";
import { balancesSnapshotFixture } from "./fixtures";
import { encodeHomeSummaryCookie, parseHomeSummaryCookie, parseHomeSummaryRecord } from "./home-summary";

const now = Date.parse("2026-10-02T05:00:00.000Z");
const raw = { version: 1, owner: "owner-a", region: "US", updatedAt: now,
  presentation: presentHomeBalances({ status: "ready", snapshot: balancesSnapshotFixture, error: null }),
  rates: { cash: { value: "4.38% APY", updatedAt: now - 60_000 }, borrow: { value: "4.78% APR", updatedAt: now - 360_000 } } };

describe("Home first-paint display cookie", () => {
  test("round trips the bounded presentation and drops expired rate claims", () => {
    const record = parseHomeSummaryRecord(JSON.stringify(raw), "owner-a", "US", now);
    if (!record) throw new Error("Summary fixture invalid");
    const cookie = encodeHomeSummaryCookie(record);
    if (!cookie) throw new Error("Cookie fixture too large");
    expect(cookie.length).toBeLessThanOrEqual(3_500);
    expect(parseHomeSummaryCookie(cookie, "owner-a", "US", now)?.presentation.displayTotal).toBe(raw.presentation.displayTotal);
    expect(parseHomeSummaryCookie(JSON.stringify(record), "owner-a", "US", now)).toEqual(record);
    expect(record.rates?.cash?.value).toBe("4.38% APY");
    expect(record.rates?.borrow).toBeUndefined();
  });
  test("wrong owners, countries, ages and malformed or oversized values are misses", () => {
    const cookie = encodeURIComponent(JSON.stringify(raw));
    expect(parseHomeSummaryCookie(cookie, "owner-b", "US", now)).toBeNull();
    expect(parseHomeSummaryCookie(cookie, "owner-a", "GB", now)).toBeNull();
    expect(parseHomeSummaryCookie(cookie, "owner-a", "US", now - 1)).toBeNull();
    expect(parseHomeSummaryCookie(cookie, "owner-a", "US", now + 8 * 86400_000)).toBeNull();
    for (const value of [undefined, "%", "null", "x".repeat(3_501)]) expect(parseHomeSummaryCookie(value, "owner-a", "US", now)).toBeNull();
  });
  test("large valid local summaries do not become oversized request cookies", () => {
    const large = { ...raw, presentation: { ...raw.presentation, displayTotal: "€".repeat(160),
      breakdown: [{ id: "cash", label: "Cash", value: "€".repeat(160), weight: 1 }] } };
    const record = parseHomeSummaryRecord(JSON.stringify(large), "owner-a", "US", now);
    if (!record) throw new Error("Summary fixture invalid");
    expect(record).not.toBeNull();
    expect(encodeHomeSummaryCookie(record)).toBeNull();
  });
});
