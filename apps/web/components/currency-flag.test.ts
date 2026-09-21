import { describe, expect, test } from "bun:test";
import { currencyFlagSrc, presentationCurrencyFlag } from "./currency-flag";

describe("presentation currency flags", () => {
  test("an unknown currency returns null so callers can fall back to the symbol", () => {
    expect(presentationCurrencyFlag("XYZ")).toBeNull();
    expect(presentationCurrencyFlag(null)).toBeNull();
  });

  test("EUR uses the EU flag and known regional currencies use their country flag", () => {
    expect(presentationCurrencyFlag("eur")).toBe("eu");
    expect(currencyFlagSrc("eu")).toBe("/currency-flags/eu.svg");
  });
});
