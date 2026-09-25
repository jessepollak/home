import { describe, expect, test } from "bun:test";
import {
  amountExceedsCeiling,
  clampDecimal,
  convertDisplayAmount,
  decimalFromBaseUnits,
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
    expect(formatPrimaryAmount("25", "native", usdUsdc, undefined, "USDC")).toBe("25 USDC");
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
    expect(parseAvailableDecimal("1234.56 USDC available")).toBe("1234.56");
    expect(parseAvailableDecimal("$1234567.8 available")).toBe("1234567.8");
    expect(parseAvailableDecimal("$12,345,678.90 available")).toBe("12345678.90");
    expect(isAvailablePositive("1240.00")).toBe(true);
    expect(isAvailablePositive("0")).toBe(false);
    expect(isAvailablePositive(null)).toBe(false);
    expect(clampDecimal("25", "15")).toBe("15");
    expect(clampDecimal("10", "1240.00")).toBe("10");
    expect(decimalFromBaseUnits("50000000", 6)).toBe("50");
    expect(decimalFromBaseUnits("128400000", 6)).toBe("128.4");
  });
});

describe("amountExceedsCeiling", () => {
  test("compares exactly at and above the ceiling, including one atom", () => {
    expect(amountExceedsCeiling("1", "1")).toBe(false);
    expect(amountExceedsCeiling("1.00", "1")).toBe(false);
    expect(amountExceedsCeiling("1.000001", "1")).toBe(true);
    expect(amountExceedsCeiling("1.000000000000000001", "1")).toBe(true);
    expect(amountExceedsCeiling("1", "1.000000000000000001")).toBe(false);
    expect(amountExceedsCeiling("0.999999999999999999", "1")).toBe(false);
    expect(amountExceedsCeiling("123456789012.000000000000000001", "123456789012")).toBe(true);
  });

  test("accepts a trailing point on amount but rejects empty, invalid and unsettled ceilings", () => {
    expect(amountExceedsCeiling("2.", "1")).toBe(true);
    expect(amountExceedsCeiling("1.", "1")).toBe(false);
    expect(amountExceedsCeiling("", "0")).toBe(false);
    expect(amountExceedsCeiling("0.", "0")).toBe(false);
    expect(amountExceedsCeiling(".", "0")).toBe(false);
    expect(amountExceedsCeiling("-2", "1")).toBe(false);
    expect(amountExceedsCeiling("2", null)).toBe(false);
    expect(amountExceedsCeiling("2", undefined)).toBe(false);
    expect(amountExceedsCeiling("2", "1.")).toBe(false);
    expect(amountExceedsCeiling("2", "not a decimal")).toBe(false);
  });
});
