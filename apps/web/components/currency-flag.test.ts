import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type FiatCurrencyCode,
  presentationRegions,
} from "@/config/regions";
import {
  currencyFlagSrc,
  presentationCurrencyFlag,
} from "./currency-flag";

const expectedFlags = {
  ARS: "ar",
  AUD: "au",
  BRL: "br",
  CAD: "ca",
  CHF: "ch",
  CLP: "cl",
  COP: "co",
  EUR: "eu",
  GBP: "gb",
  IDR: "id",
  MXN: "mx",
  MYR: "my",
  NGN: "ng",
  NZD: "nz",
  PEN: "pe",
  SGD: "sg",
  TRY: "tr",
  USD: "us",
  ZAR: "za",
} as const satisfies Record<FiatCurrencyCode, string>;

describe("presentationCurrencyFlag", () => {
  test("maps every presentation/cash currency onto a vendored circle flag", () => {
    const codes = new Set<string>();
    for (const region of Object.values(presentationRegions)) {
      if (region.currency.code) codes.add(region.currency.code);
    }
    expect([...codes].sort()).toEqual(Object.keys(expectedFlags).sort());

    for (const [currency, flag] of Object.entries(expectedFlags)) {
      expect(presentationCurrencyFlag(currency)).toBe(flag);
      expect(presentationCurrencyFlag(currency.toLowerCase())).toBe(flag);
      expect(currencyFlagSrc(flag)).toBe(`/currency-flags/${flag}.svg`);
    }
  });

  test("uses the EU flag for EUR, not a member-state flag", () => {
    expect(presentationCurrencyFlag("EUR")).toBe("eu");
    expect(presentationCurrencyFlag("eur")).toBe("eu");
  });

  test("does not invent flags for crypto, stables, or unknown tickers", () => {
    for (const ticker of ["ETH", "BTC", "USDC", "IDRX", "EURC", "BRZ", "XYZ"]) {
      expect(presentationCurrencyFlag(ticker)).toBeNull();
    }
    expect(presentationCurrencyFlag(null)).toBeNull();
    expect(presentationCurrencyFlag("")).toBeNull();
    expect(presentationCurrencyFlag("  ")).toBeNull();
  });
});

describe("vendored currency flags", () => {
  test("ships an SVG for every mapped presentation currency", async () => {
    const dir = join(import.meta.dir, "../public/currency-flags");
    const files = new Set(await readdir(dir));
    for (const flag of Object.values(expectedFlags)) {
      expect(files.has(`${flag}.svg`)).toBe(true);
    }
  });
});
