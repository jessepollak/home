import { describe, expect, test } from "bun:test";
import { readExpiry } from "./adapter";

describe("readExpiry", () => {
  test("keeps an explicit offset and normalizes to ISO", () => {
    expect(readExpiry("2026-09-12T15:00:00+07:00")).toBe("2026-09-12T08:00:00.000Z");
    expect(readExpiry("2026-09-12 15:00:00+0700")).toBe("2026-09-12T08:00:00.000Z");
    expect(readExpiry("2026-09-12T15:00:00Z")).toBe("2026-09-12T15:00:00.000Z");
  });

  test("ignores parseable values with no real offset", () => {
    expect(readExpiry("+2026")).toBeNull();
    expect(readExpiry("-2026")).toBeNull();
    expect(readExpiry("2026-09-12 15:00:00")).toBeNull();
    expect(readExpiry("Fri, 12 Sep 2026 10:00:00 GMT")).toBeNull();
  });

  test("normalizes a rolled-over calendar date to a stored-safe timestamp", () => {
    expect(readExpiry("2026-02-30T00:00:00Z")).toBe("2026-03-02T00:00:00.000Z");
  });

  test("throws for an invalid expiry", () => {
    expect(() => readExpiry("garbage")).toThrow("Invalid IDRX expiry.");
  });
});
