import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { canonicalUsdcAsset } from "@/config/portfolio-assets";
import { requiredLocalCashAsset } from "@/shared/balances/fixtures";
import { cashCurrencyForContract } from "@/shared/currencies/registry";
import {
  amountExceedsCeiling,
  clampDecimal,
  decimalFromBaseUnits,
  displayCurrencyForRegion,
  formatAvailableDecimal,
  formatAvailableLine,
  formatChipLabel,
  formatPrimaryAmount,
  formatPrimaryAmountUnit,
  isAvailablePositive,
  moneyAmountUnit,
  fiatToNative,
  nativeToFiat,
  parseAvailableDecimal,
  type MoneyAmountUnit,
} from "./amount-units";

const fiatUsd: MoneyAmountUnit = { kind: "fiat", currency: "USD" };
const native: MoneyAmountUnit = { kind: "native" };

describe("moneyAmountUnit", () => {
  test.each([
    ["USD", "USD", fiatUsd],
    ["EUR", "EUR", { kind: "fiat", currency: "EUR" }],
    ["IDR", "IDR", { kind: "fiat", currency: "IDR" }],
    ["USD", "EUR", native],
    ["EUR", "USD", native],
    [null, "USD", native],
    ["USD", "", native],
    ["USD", "XYZ", native],
    ["USD", null, native],
    ["USD", undefined, native],
    ["", "USD", native],
    [" usd ", " UsD ", fiatUsd],
  ] as const)("returns the semantic unit for cash %s and display %s", (cash, display, expected) => {
    expect(moneyAmountUnit(cash, display)).toEqual(expected);
  });

  test("trusts only verified cash contracts, regardless of displayed token symbol", () => {
    expect(cashCurrencyForContract("0x0000000000000000000000000000000000000001")).toBeNull();
    expect(moneyAmountUnit(cashCurrencyForContract("0x0000000000000000000000000000000000000001"), "USD")).toEqual(native);
    expect(cashCurrencyForContract(getAddress(canonicalUsdcAsset.contractAddress))).toBe("USD");
    expect(cashCurrencyForContract(requiredLocalCashAsset("EUR").contractAddress)).toBe("EUR");
    expect(cashCurrencyForContract(requiredLocalCashAsset("IDR").contractAddress)).toBe("IDR");
    expect(cashCurrencyForContract(null)).toBeNull();
  });

  test("follows the selected display region without converting the asset", () => {
    expect(displayCurrencyForRegion("US")).toBe("USD");
    expect(displayCurrencyForRegion("DE")).toBe("EUR");
    expect(displayCurrencyForRegion("GLOBAL")).toBe("USD");
    expect(moneyAmountUnit("USD", displayCurrencyForRegion("US"))).toEqual(fiatUsd);
    expect(moneyAmountUnit("USD", displayCurrencyForRegion("DE"))).toEqual(native);
  });
});

describe("primary unit and chips", () => {
  test("formats fiat and native amounts without changing the exact entry", () => {
    expect(formatPrimaryAmount("25.123456", fiatUsd, "USDC")).toBe("$25.123456");
    expect(formatPrimaryAmount("25.123456", native, "USDC")).toBe("25.123456 USDC");
    expect(formatPrimaryAmount("", fiatUsd, "USDC")).toBe("$0");
    expect(formatPrimaryAmountUnit(fiatUsd, "USDC")).toBe("US dollar");
    expect(formatPrimaryAmountUnit(native, "USDC")).toBe("USDC");
    expect(formatPrimaryAmount("25", { kind: "fiat", currency: "IDR" }, "IDRX")).toBe("Rp 25");
    expect(formatChipLabel(10, "USD")).toBe("$10");
    expect(formatChipLabel(25, "USD")).toBe("$25");
    expect(formatAvailableLine("$1,240.00 available", fiatUsd, "USDC")).toBe("$1,240.00 available");
    expect(formatAvailableDecimal("1234.56", fiatUsd, "USDC")).toBe("$1,234.56 available");
    expect(formatAvailableDecimal("1234.5", native, "ETH")).toBe("1,234.5 ETH available");
    expect(formatAvailableLine("Balance unavailable", native, "ETH")).toBe("Balance unavailable");
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

describe("priced asset units", () => {
  const usdPrice = { currency: "USD", perUnit: { atoms: "6500000", scale: 2 } };
  test.each([
    ["USD", "USD", usdPrice, { kind: "fiat", currency: "USD" }],
    ["EUR", "EUR", usdPrice, { kind: "fiat", currency: "EUR" }],
    ["EUR", "USD", usdPrice, { kind: "convertible", currency: "USD", perUnit: { atoms: "65000", scale: 0 } }],
    [null, "USD", usdPrice, { kind: "convertible", currency: "USD", perUnit: { atoms: "65000", scale: 0 } }],
    [null, "USD", null, { kind: "native" }],
    [null, "USD", { currency: "EUR", perUnit: { atoms: "65000", scale: 0 } }, { kind: "native" }],
    [null, "USD", { currency: "USD", perUnit: { atoms: "0", scale: 0 } }, { kind: "native" }],
    [null, "USD", { currency: "USD", perUnit: { atoms: "12.5", scale: 0 } }, { kind: "native" }],
    [null, "USD", { currency: "USD", perUnit: { atoms: "100", scale: -1 } }, { kind: "native" }],
    [null, "USD", { currency: "USD", perUnit: { atoms: "100", scale: 0.5 } }, { kind: "native" }],
  ] as const)("classifies priced asset cash %s display %s and price %p", (cash, display, price, expected) => {
    expect(moneyAmountUnit(cash, display, price)).toEqual(expected);
  });

  test("normalizes equivalent positive prices and ignores symbol-like cash claims", () => {
    expect(moneyAmountUnit(null, " usd ", { currency: " usd ", perUnit: { atoms: "001000", scale: 3 } }))
      .toEqual(moneyAmountUnit(null, "USD", { currency: "USD", perUnit: { atoms: "1", scale: 0 } }));
    expect(moneyAmountUnit(null, "USD")).toEqual(native);
    expect(formatAvailableDecimal("0.001", moneyAmountUnit(null, "USD", usdPrice), "cbBTC"))
      .toBe("0.001 cbBTC available");
  });
});

describe("exact price conversion", () => {
  test.each([
    ["", { atoms: "65000", scale: 0 }, 8, ""],
    ["0", { atoms: "65000", scale: 0 }, 8, "0"],
    ["100", { atoms: "65000", scale: 0 }, 8, "0.00153846"],
    ["0.01", { atoms: "3", scale: 0 }, 8, "0.00333333"],
    ["1", { atoms: "3", scale: 0 }, 18, "0.333333333333333333"],
    ["1", { atoms: "2", scale: 0 }, 18, "0.5"],
  ] as const)("floors fiat %s to native precision %s", (fiat, price, decimals, expected) => {
    expect(fiatToNative(fiat, price, decimals)).toBe(expected);
  });
  test.each([
    ["", { atoms: "65000", scale: 0 }, ""],
    ["0", { atoms: "65000", scale: 0 }, "0.00"],
    ["0.001", { atoms: "65000", scale: 0 }, "65.00"],
    ["0.00153846", { atoms: "65000", scale: 0 }, "99.99"],
    ["0.000000000000000001", { atoms: "10000000000000000", scale: 0 }, "0.01"],
    ["1.000000000000000001", { atoms: "100", scale: 0 }, "100.00"],
  ] as const)("floors native %s to cents", (nativeAmount, price, expected) => {
    expect(nativeToFiat(nativeAmount, price)).toBe(expected);
  });
});
