import { describe, expect, test } from "bun:test";
import { configuredMajorTokenSymbols } from "./invest-asset-symbols";
import { cryptoAssets, memeAssets, stockAssets } from "./invest-assets";

describe("configured major token display classification", () => {
  test("matches every configured stock and crypto token symbol", () => {
    const expected = [...stockAssets, ...cryptoAssets].map((asset) =>
      asset.representation.tokenSymbol.toUpperCase()
    );
    expect([...configuredMajorTokenSymbols].sort()).toEqual([...expected].sort());
  });

  test("does not classify configured meme token symbols as major", () => {
    const majorSymbols = new Set(configuredMajorTokenSymbols);
    const memeSymbols = memeAssets.map((asset) => asset.representation.tokenSymbol.toUpperCase());
    expect(memeSymbols.filter((symbol) => majorSymbols.has(symbol))).toEqual([]);
  });
});
