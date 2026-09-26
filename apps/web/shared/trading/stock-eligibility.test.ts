import { describe, expect, test } from "bun:test";
import { stockAssets } from "@/config/invest-assets";
import { findStockAsset, stockBuyAllowedForCountry, US_JURISDICTIONS } from "./stock-eligibility";

describe("stock eligibility rule", () => {
  test.each(["US", "PR", "GU", "VI", "AS", "MP", "UM"])("restricts %s", (country) => {
    expect(US_JURISDICTIONS.has(country)).toBe(true);
    expect(stockBuyAllowedForCountry(country)).toBe(false);
  });
  test.each([null, "XX", "ZZ", "QQ", "XK", "D", "de", "DE "])("fails closed for invalid %s", (country) => {
    expect(stockBuyAllowedForCountry(country)).toBe(false);
  });
  test.each(["DE", "GB", "CA", "FR"])("permits assigned non-US %s", (country) => {
    expect(stockBuyAllowedForCountry(country)).toBe(true);
  });
  test("resolves every roster entry by id or Base address", () => {
    for (const asset of stockAssets) {
      expect(findStockAsset(asset.id)).toEqual(asset);
      expect(findStockAsset(`base:${asset.contractAddress.toUpperCase()}`)).toEqual(asset);
      expect(findStockAsset(asset.contractAddress.toLowerCase())).toEqual(asset);
    }
    expect(findStockAsset("cbbtc")).toBeNull();
    expect(findStockAsset("base:0x0000000000000000000000000000000000000000")).toBeNull();
  });
});
