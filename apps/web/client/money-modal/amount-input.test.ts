import { describe, expect, test } from "bun:test";
import {
  decimalSeparatorForLocale,
  isPositiveDecimalAmount,
  MAX_AMOUNT_WHOLE_DIGITS,
  normalizeTypedAmount,
  parsePastedAmount,
} from "./amount-input";

describe("normalizeTypedAmount", () => {
  test("treats either typed separator as decimal, permits one and preserves trailing separator", () => {
    for (const [raw, value] of [
      ["12.5", "12.5"],
      ["12,5", "12.5"],
      ["25.", "25."],
      ["25,", "25."],
      [".5", "0.5"],
      [",5", "0.5"],
      [".", "0."],
      [",", "0."],
    ]) {
      expect(normalizeTypedAmount(raw, 2)).toEqual({ ok: true, value });
    }
    for (const raw of ["1.2.3", "1,2,3", "1.2,3", "1,2.3"]) {
      expect(normalizeTypedAmount(raw, 6)).toEqual({ ok: false });
    }
  });

  test("enforces asset fraction precision at 0, 2, 6 and 18 decimals", () => {
    expect(normalizeTypedAmount("12", 0)).toEqual({ ok: true, value: "12" });
    expect(normalizeTypedAmount("12.", 0)).toEqual({ ok: false });
    expect(normalizeTypedAmount("12,0", 0)).toEqual({ ok: false });
    expect(normalizeTypedAmount("12.34", 2)).toEqual({ ok: true, value: "12.34" });
    expect(normalizeTypedAmount("12.345", 2)).toEqual({ ok: false });
    expect(normalizeTypedAmount("0.123456", 6)).toEqual({ ok: true, value: "0.123456" });
    expect(normalizeTypedAmount("0.1234567", 6)).toEqual({ ok: false });
    expect(normalizeTypedAmount("0.123456789012345678", 18)).toEqual({ ok: true, value: "0.123456789012345678" });
    expect(normalizeTypedAmount("0.1234567890123456789", 18)).toEqual({ ok: false });
  });

  test("caps whole digits after collapsing leading zeros", () => {
    expect(MAX_AMOUNT_WHOLE_DIGITS).toBe(12);
    expect(normalizeTypedAmount("123456789012", 2)).toEqual({ ok: true, value: "123456789012" });
    expect(normalizeTypedAmount("1234567890123", 2)).toEqual({ ok: false });
    expect(normalizeTypedAmount("000123456789012.3", 2)).toEqual({ ok: true, value: "123456789012.3" });
    expect(normalizeTypedAmount("0001234567890123", 2)).toEqual({ ok: false });
  });

  test("collapses leading zeros and allows deletion to an empty field", () => {
    for (const [raw, value] of [
      ["00", "0"], ["05", "5"], ["007.5", "7.5"], ["0.5", "0.5"],
      ["000", "0"], ["000.00", "0.00"], ["", ""],
    ]) {
      expect(normalizeTypedAmount(raw, 2)).toEqual({ ok: true, value });
    }
  });

  test("rejects letters, signs, spaces and non-ASCII digits", () => {
    for (const raw of ["1e5", "1E5", "a", "1a", "+3", "-3", " 1", "1 ", "1 2", "١٢", "1€"]) {
      expect(normalizeTypedAmount(raw, 2)).toEqual({ ok: false });
    }
  });
});

describe("parsePastedAmount", () => {
  test("parses locale-independent mixed separators using the last as decimal", () => {
    for (const locale of [".", ","] as const) {
      for (const [text, value] of [
        ["1,234.56", "1234.56"], ["1.234,56", "1234.56"],
        ["1,234,567.89", "1234567.89"],
      ]) {
        expect(parsePastedAmount(text, locale)).toEqual({ ok: true, value });
      }
      expect(parsePastedAmount("1,2.3.4", locale)).toEqual({ ok: false });
      expect(parsePastedAmount("1.2,3,4", locale)).toEqual({ ok: false });
    }
  });

  test("removes repeated same-kind grouping separators", () => {
    for (const locale of [".", ","] as const) {
      expect(parsePastedAmount("1,234,567", locale)).toEqual({ ok: true, value: "1234567" });
      expect(parsePastedAmount("1.234.567", locale)).toEqual({ ok: true, value: "1234567" });
      expect(parsePastedAmount("1 234 567,89", locale)).toEqual({ ok: true, value: "1234567.89" });
      expect(parsePastedAmount("1'234'567.5", locale)).toEqual({ ok: true, value: "1234567.5" });
      expect(parsePastedAmount("1’234'567.5", locale)).toEqual({ ok: true, value: "1234567.5" });
      expect(parsePastedAmount("1 234\u202f567,89", locale)).toEqual({ ok: true, value: "1234567.89" });
    }
  });

  test("disambiguates a single separator using the device locale and grouping shape", () => {
    for (const [text, locale, value] of [
      ["1,234", ".", "1234"], ["1,5", ".", "1.5"],
      ["0,001", ".", "0.001"], ["1.234", ",", "1234"],
      ["1.5", ",", "1.5"], ["1,234", ",", "1.234"],
      ["1.234", ".", "1.234"], ["01,234", ".", "1234"],
      ["1234,567", ".", "1234.567"], [",123", ".", "0.123"],
      [",123", ",", "0.123"],
    ] as const) {
      expect(parsePastedAmount(text, locale)).toEqual({ ok: true, value });
    }
  });

  test("strips currency symbols, whitespace and apostrophe grouping", () => {
    for (const [text, locale, value] of [
      ["$1,234.56", ".", "1234.56"],
      ["$12.50", ".", "12.50"],
      ["12,50 €", ",", "12.50"],
      ["€ 3", ".", "3"],
      ["1 234,56 €", ",", "1234.56"],
      ["1\u00a0234,56 €", ",", "1234.56"],
      ["1\u202f234,56 €", ",", "1234.56"],
      ["1\u2009234,56 €", ",", "1234.56"],
      ["1'234,56", ",", "1234.56"],
      ["1’234,56", ",", "1234.56"],
      ["  $ 007.5  ", ".", "7.5"],
      [".5", ".", "0.5"], [".", ".", "0."],
    ] as const) {
      expect(parsePastedAmount(text, locale)).toEqual({ ok: true, value });
    }
  });

  test("rejects embedded or multiple currency symbols", () => {
    for (const text of ["1$000", "12€34", "$1$2", "$1€", "€ 3 $"]) {
      expect(parsePastedAmount(text, ".")).toEqual({ ok: false });
      expect(parsePastedAmount(text, ",")).toEqual({ ok: false });
    }
  });

  test("rejects malformed grouping and mixed grouping kinds", () => {
    for (const text of [
      "1.2.3", "12,34,56", "1,2,3.45", "1.2.3,4", "1.2,5",
      "1,23,456.7", "12 34,56", "1'2'3", "1,234.567.8",
      "1 234.567,8", "1 234,567.8", "1,234 567.8", "1'234 567.8",
      "123,456,", ".123.456", "1,234,56", "1 234, 56", "1'234.5'6",
      "'123", "123'", "1,234'", "1\t234.56",
    ]) {
      expect(parsePastedAmount(text, ".")).toEqual({ ok: false });
      expect(parsePastedAmount(text, ",")).toEqual({ ok: false });
    }
  });

  test("rejects unrecognized text and signs", () => {
    for (const text of ["1e5", "-3", "+3", "12 USDC", "abc", "1E5", "1/2", "١٢"]) {
      expect(parsePastedAmount(text, ".")).toEqual({ ok: false });
      expect(parsePastedAmount(text, ",")).toEqual({ ok: false });
    }
  });

  test("leaves precision and whole-digit validation to the caller", () => {
    expect(parsePastedAmount("1234567890123.123", ".")).toEqual({ ok: true, value: "1234567890123.123" });
    expect(normalizeTypedAmount("1234567890123.123", 2)).toEqual({ ok: false });
  });
});

describe("decimalSeparatorForLocale", () => {
  test("reads the locale decimal and defaults to a point when unsupported", () => {
    expect(decimalSeparatorForLocale("en-US")).toBe(".");
    expect(decimalSeparatorForLocale("de-DE")).toBe(",");
    expect(decimalSeparatorForLocale("not_a_locale")).toBe(".");
    expect(decimalSeparatorForLocale(undefined)).toBe(".");
  });
});

describe("isPositiveDecimalAmount", () => {
  test("gates Continue on a positive decimal", () => {
    expect(isPositiveDecimalAmount("")).toBe(false);
    expect(isPositiveDecimalAmount("0")).toBe(false);
    expect(isPositiveDecimalAmount("0.00")).toBe(false);
    expect(isPositiveDecimalAmount("25.")).toBe(true);
    expect(isPositiveDecimalAmount("0.01")).toBe(true);
    expect(isPositiveDecimalAmount("25")).toBe(true);
  });
});
