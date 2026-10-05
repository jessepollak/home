import { describe, expect, test } from "bun:test";
import { parseUsdcAmount } from "./format";

describe("savings format", () => {
  test("parses dollar amounts into six-decimal USDC base units", () => {
    expect(parseUsdcAmount("100")).toBe("100000000");
    expect(parseUsdcAmount("1.234567")).toBe("1234567");
  });

  test("rejects excess USDC precision with the existing error", () => {
    expect(() => parseUsdcAmount("1.0000001")).toThrow(new Error("USDC supports at most 6 decimal places."));
  });

  test.each(["0", "0.000000", "000."])("rejects zero %s with the existing error", (value) => {
    expect(() => parseUsdcAmount(value)).toThrow(new Error("Enter a positive USDC amount."));
  });

  test.each(["", "1e3", ".5", "1.2.3", "-1", "1,000"])("rejects malformed %j with the existing error", (value) => {
    expect(() => parseUsdcAmount(value)).toThrow(new Error("Enter a positive USDC amount using decimal digits only."));
  });

  test.each([
    ["0001.234567", "1234567"],
    ["000.000001", "1"],
    ["1.", "1000000"],
    [" 0001. ", "1000000"],
  ])("normalizes %j to exact base units", (value, expected) => {
    expect(parseUsdcAmount(value)).toBe(expected);
  });
});
