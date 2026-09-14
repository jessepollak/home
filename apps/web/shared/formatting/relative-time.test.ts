import { describe, expect, test } from "bun:test";
import { formatRelativeTime } from "./relative-time";

const NOW = Date.parse("2026-09-13T12:03:00.000Z");

describe("relative time formatting", () => {
  test.each([
    ["2026-09-13T12:02:45.000Z", "just now"],
    ["2026-09-13T12:00:00.000Z", "3 min ago"],
    ["2026-09-13T10:00:00.000Z", "2 hr ago"],
    ["2026-09-12T12:00:00.000Z", "1 day ago"],
  ])("formats %s as %s", (timestamp, expected) => {
    expect(formatRelativeTime(timestamp, NOW)).toBe(expected);
  });
});
