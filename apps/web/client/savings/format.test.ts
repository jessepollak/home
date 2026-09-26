import { describe, expect, test } from "bun:test";
import { parseUsdcAmount } from "./format";

describe("savings format", () => {
  test("parses dollar amounts into six-decimal USDC base units", () => {
    expect(parseUsdcAmount("100")).toBe("100000000");
    expect(parseUsdcAmount("1.234567")).toBe("1234567");
  });
});
