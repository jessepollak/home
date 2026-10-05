import { describe, expect, test } from "bun:test";
import { parseTradeAmount } from "./amount";

describe("trade amount parsing", () => {
  test.each([
    ["42", 0, "42"],
    ["1.234567", 6, "1234567"],
    ["0.000000000000000001", 18, "1"],
    ["0.000000000000000000000000000000000001", 36, "1"],
    ["1", 36, "1000000000000000000000000000000000000"],
  ])("parses %s at %s decimals without rounding", (value, decimals, expected) => {
    expect(parseTradeAmount(value, decimals)).toBe(expected);
  });

  test("accepts the uint256 maximum and rejects overflow", () => {
    const maximum = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(parseTradeAmount(maximum, 0)).toBe(maximum);
    expect(parseTradeAmount("115792089237316195423570985008687907853269984665640564039457584007913129639936", 0)).toBeNull();
  });

  test.each(["1e3", "", " ", ".5", "1.2.3", "-1", "1,000", "0", "0.000000", "1.0000001"])(
    "returns null for invalid or nonpositive amount %j",
    (value) => {
      expect(parseTradeAmount(value, 6)).toBeNull();
    },
  );

  test.each([
    ["0001.234567", "1234567"],
    ["000.000001", "1"],
    ["1.", "1000000"],
    [" 0001. ", "1000000"],
  ])("normalizes %j to exact base units", (value, expected) => {
    expect(parseTradeAmount(value, 6)).toBe(expected);
  });

  test.each([-1, 1.5, 256, NaN, Infinity])("returns null for invalid decimals %s", (decimals) => {
    expect(parseTradeAmount("1", decimals)).toBeNull();
  });
});
