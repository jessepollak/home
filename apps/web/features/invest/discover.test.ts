import { describe, expect, test } from "bun:test";
import { cryptoAssets } from "@/config/invest-assets";
import {
  discoverShelves,
  getDiscoverAsset,
  getDiscoverShelf,
  getShelfPreviewAssets,
} from "./discover";

describe("invest discovery catalog", () => {
  test("keeps Stocks, Crypto, then Memes shelves with the signed-off preview roster", () => {
    expect(discoverShelves.map((shelf) => shelf.title)).toEqual([
      "Stocks",
      "Crypto",
      "Memes",
    ]);
    expect(getShelfPreviewAssets(discoverShelves[0]).map((asset) => asset.displaySymbol)).toEqual([
      "NVDA",
      "META",
      "AAPL",
      "GOOGL",
    ]);
    expect(getShelfPreviewAssets(discoverShelves[1]).map((asset) => asset.displaySymbol)).toEqual([
      "BTC",
      "XRP",
      "DOGE",
      "LTC",
    ]);
    expect(getShelfPreviewAssets(discoverShelves[2]).map((asset) => asset.displaySymbol)).toEqual([
      "DEGEN",
      "TOSHI",
    ]);
  });

  test("keeps Cardano on the Crypto category list and off the hub preview", () => {
    const crypto = getDiscoverShelf("crypto");
    expect(crypto?.assets.map((asset) => asset.id)).toEqual(
      cryptoAssets.map((asset) => asset.id),
    );
    expect(crypto?.assets.map((asset) => asset.displaySymbol)).toContain("ADA");
    expect(
      getShelfPreviewAssets(crypto!).map((asset) => asset.displaySymbol),
    ).not.toContain("ADA");
    expect(getDiscoverAsset("cbbtc")?.displayName).toBe("Bitcoin");
  });
});
