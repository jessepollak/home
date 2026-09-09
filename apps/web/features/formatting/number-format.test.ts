import { describe, expect, test } from "bun:test";
import {
  formatPercentage,
  formatPresentationPrice,
  formatPresentationTokenAmount,
  formatSignedPercentChange,
  formatTokenAmount,
  formatUsdPrice,
  presentationAssetClass,
  scaleDecimalByExact,
} from "./number-format";

describe("financial number formatting", () => {
  test("formats ordinary USD prices with grouping and cents", () => {
    expect(formatUsdPrice("231.708792875")).toBe("$231.71");
    expect(formatUsdPrice("614.074104553")).toBe("$614.07");
    expect(formatUsdPrice("12345678901234567890.1")).toBe(
      "$12,345,678,901,234,567,890.10",
    );
    expect(formatUsdPrice(0)).toBe("$0.00");
    expect(formatUsdPrice("0")).toBe("$0.00");
    expect(formatUsdPrice("0e1")).toBe("$0.00");
    expect(formatUsdPrice("0.0e2")).toBe("$0.00");
    expect(formatUsdPrice("-0e1")).toBe("$0.00");
  });

  test("keeps useful precision for sub-cent USD prices without unbounded output", () => {
    expect(formatUsdPrice("0.000123456789")).toBe("$0.0001235");
    expect(formatUsdPrice("1e-7")).toBe("$0.0000001");
    expect(formatUsdPrice("0.000000001")).toBe("<$0.00000001");
  });

  test("rejects invalid and nonfinite USD inputs", () => {
    expect(formatUsdPrice("$1.25")).toBeNull();
    expect(formatUsdPrice("not-a-price")).toBeNull();
    expect(formatUsdPrice(Number.NaN)).toBeNull();
    expect(formatUsdPrice(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("bounds token decimals and marks nonzero values below the display precision", () => {
    expect(formatTokenAmount("1234567890123456789012345", 6)).toBe(
      "1,234,567,890,123,456,789.012345",
    );
    expect(formatTokenAmount("1234500", 6)).toBe("1.2345");
    expect(formatTokenAmount("1234567", 0)).toBe("1,234,567");
    expect(formatTokenAmount("1", 18)).toBe("<0.000001");
    expect(formatTokenAmount("0", 18)).toBe("0");
  });

  test("rejects malformed token amounts and invalid display bounds", () => {
    expect(() => formatTokenAmount("01", 6)).toThrow(TypeError);
    expect(() => formatTokenAmount("1", 6, 7)).toThrow(TypeError);
  });

  test("formats percentages consistently and rejects nonfinite values", () => {
    expect(formatPercentage(0.045)).toBe("4.50%");
    expect(formatPercentage(0)).toBe("0%");
    expect(formatPercentage(null)).toBe("Unavailable");
    expect(formatPercentage(Number.NaN)).toBe("Unavailable");
    expect(formatPercentage(Number.NEGATIVE_INFINITY)).toBe("Unavailable");
  });

  test("classifies majors, stables, and memes without inventing a cash peg", () => {
    expect(presentationAssetClass({ symbol: "ETH" })).toBe("major");
    expect(presentationAssetClass({ symbol: "cbBTC" })).toBe("major");
    expect(presentationAssetClass({ symbol: "NVDAc" })).toBe("major");
    expect(presentationAssetClass({ symbol: "USDC" })).toBe("stable");
    expect(presentationAssetClass({ cashCurrency: "IDR", symbol: "IDRX" })).toBe(
      "stable",
    );
    expect(presentationAssetClass({ symbol: "DEGEN" })).toBe("meme");
    expect(presentationAssetClass({ category: "meme", symbol: "HIGHER" })).toBe(
      "meme",
    );
    expect(presentationAssetClass({ category: "crypto", symbol: "HIGHER" })).toBe(
      "major",
    );
  });

  test("bounds ETH majors to 4–6 dp and marks wei dust", () => {
    expect(
      formatPresentationTokenAmount("1101012331497033445", 18, "ETH"),
    ).toBe("1.1010 ETH");
    expect(
      formatPresentationTokenAmount("50000000000000000", 18, "ETH"),
    ).toBe("0.0500 ETH");
    expect(
      formatPresentationTokenAmount("1000000000000000", 18, "ETH"),
    ).toBe("0.001 ETH");
    expect(formatPresentationTokenAmount("1", 18, "ETH")).toBe("<0.000001 ETH");
    expect(formatPresentationTokenAmount("0", 18, "ETH")).toBe("0 ETH");
    expect(
      formatPresentationTokenAmount("1101012331497033445", 18, "ETH"),
    ).not.toContain("1.101012331497033445");
  });

  test("keeps stables at 2 dp and meme wholes at 0 dp", () => {
    expect(
      formatPresentationTokenAmount("10000000", 6, "USDC", {
        cashCurrency: "USD",
      }),
    ).toBe("10.00 USDC");
    expect(
      formatPresentationTokenAmount("10000", 2, "IDRX", { cashCurrency: "IDR" }),
    ).toBe("100.00 IDRX");
    expect(
      formatPresentationTokenAmount("45690152000000000000000000", 18, "JESSE", {
        category: "meme",
      }),
    ).toBe("45,690,152 JESSE");
    expect(
      formatPresentationTokenAmount("500000000000000000", 18, "DEGEN", {
        category: "meme",
      }),
    ).toBe("0.5 DEGEN");
  });

  test("formats local presentation prices with the same rounding as USD", () => {
    expect(formatPresentationPrice("231.708792875", "IDR")).toBe("Rp 231.71");
    expect(formatPresentationPrice("0.000123456789", "IDR")).toBe(
      "Rp 0.0001235",
    );
    expect(formatPresentationPrice("0", "IDR")).toBe("Rp 0.00");
    expect(formatPresentationPrice("231.708792875", "BRL")).toBe("R$ 231,71");
  });

  test("scales a USD price by an exact FX factor without JS floats", () => {
    expect(
      scaleDecimalByExact("231.708792875", { atoms: "16425", scale: 0 }),
    ).toBe("3805816.922971875");
    expect(scaleDecimalByExact("1", { atoms: "0", scale: 0 })).toBe("0");
    expect(scaleDecimalByExact("not-a-price", { atoms: "1", scale: 0 })).toBeNull();
  });

  test("formats Invest Δ% to two signed decimal places", () => {
    expect(formatSignedPercentChange("+9.8%")).toBe("+9.80%");
    expect(formatSignedPercentChange("1.25%")).toBe("+1.25%");
    expect(formatSignedPercentChange("-0.667%")).toBe("-0.67%");
    expect(formatSignedPercentChange("\u22120.67%")).toBe("-0.67%");
    expect(formatSignedPercentChange(9.87)).toBe("+9.87%");
    expect(formatSignedPercentChange(0)).toBe("+0.00%");
    expect(formatSignedPercentChange("down")).toBeNull();
    expect(formatSignedPercentChange(Number.NaN)).toBeNull();
  });
});
