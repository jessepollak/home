import { describe, expect, test } from "bun:test";
import {
  clampDecimal,
  convertDisplayAmount,
  decimalFromBaseUnits,
  formatAvailableLine,
  formatChipLabel,
  formatPrimaryAmount,
  formatSecondaryAmount,
  isAvailablePositive,
  moneyAssetPricing,
  parseAvailableDecimal,
  resolvePrimaryUnit,
} from "./amount-units";

const usdUsdc = moneyAssetPricing("USDC", "US");

describe("moneyAssetPricing", () => {
  test("prices USD stables 1:1 and leaves ETH unpriced", () => {
    expect(moneyAssetPricing("USDC")).toEqual({
      status: "priced",
      localCurrency: "USD",
      nativePerLocal: { atoms: "1", scale: 0 },
    });
    expect(moneyAssetPricing("ETH")).toEqual({ status: "unpriced" });
    expect(moneyAssetPricing("USDC", "BR")).toEqual({ status: "unpriced" });
  });
});

describe("primary unit and chips", () => {
  test("defaults to local when priced and forces native when unpriced", () => {
    expect(resolvePrimaryUnit(usdUsdc, "local")).toBe("local");
    expect(resolvePrimaryUnit(usdUsdc, "native")).toBe("native");
    expect(resolvePrimaryUnit({ status: "unpriced" }, "local")).toBe("native");
  });

  test("formats local/native primary and secondary without changing the native amount", () => {
    expect(formatPrimaryAmount("25", "local", usdUsdc)).toBe("$25");
    expect(formatPrimaryAmount("25", "native", usdUsdc)).toBe("25");
    expect(formatSecondaryAmount("25", "local", usdUsdc, "USDC")).toBe("25.00 USDC");
    expect(formatSecondaryAmount("25", "native", usdUsdc, "USDC")).toBe("$25.00");
    expect(convertDisplayAmount("25", "local", "native", usdUsdc)).toBe("25");
    expect(formatChipLabel(10, "USD")).toBe("$10");
    expect(formatChipLabel(25, "USD")).toBe("$25");
  });
});

describe("available parse and Max", () => {
  test("parses presentation labels and disables empty or dust-style amounts", () => {
    expect(parseAvailableDecimal("$1,240.00 available")).toBe("1240.00");
    expect(parseAvailableDecimal("1,240.00 USDC")).toBe("1240.00");
    expect(parseAvailableDecimal("0.0500 ETH")).toBe("0.0500");
    expect(parseAvailableDecimal("<$0.01 available")).toBeNull();
    expect(isAvailablePositive("1240.00")).toBe(true);
    expect(isAvailablePositive("0")).toBe(false);
    expect(isAvailablePositive(null)).toBe(false);
    expect(clampDecimal("25", "15")).toBe("15");
    expect(clampDecimal("10", "1240.00")).toBe("10");
    expect(decimalFromBaseUnits("50000000", 6)).toBe("50");
    expect(decimalFromBaseUnits("128400000", 6)).toBe("128.4");
  });

  test("rewrites the available line for the current primary unit", () => {
    expect(formatAvailableLine("$1,240.00 available", "local", usdUsdc, "USDC")).toBe(
      "$1,240.00 available",
    );
    expect(formatAvailableLine("$1,240.00 available", "native", usdUsdc, "USDC")).toBe(
      "1,240.00 USDC available",
    );
  });
});
