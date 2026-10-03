import { describe, expect, test } from "bun:test";
import { checkoutDeadline } from "./checkout-deadline";

describe("checkoutDeadline", () => {
  test("uses a usable provider expiry", () => {
    expect(checkoutDeadline({ expiresAt: "2026-09-12T00:05:00.000Z", createdAt: "2026-09-12T00:00:00.000Z" }))
      .toBe(Date.parse("2026-09-12T00:05:00.000Z"));
  });

  test("falls back to the stale window for a missing or unusable provider expiry", () => {
    const createdAt = "2026-09-12T00:00:00.000Z";
    expect(checkoutDeadline({ expiresAt: null, createdAt })).toBe(Date.parse(createdAt) + 24 * 60 * 60 * 1_000);
    expect(checkoutDeadline({ expiresAt: "not-a-date", createdAt })).toBe(Date.parse(createdAt) + 24 * 60 * 60 * 1_000);
  });
});
