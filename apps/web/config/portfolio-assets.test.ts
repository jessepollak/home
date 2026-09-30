import { describe, expect, test } from "bun:test";
import { BASE_FUNDING_ASSETS } from "@/shared/assets/base";
import { investAssets } from "./invest-assets";
import {
  assetKeyForErc20,
  getDirectPortfolioAssets,
  verifiedCashCurrency,
  verifiedLocalCashAssets,
} from "./portfolio-assets";

const fundingBackedCash = [
  { currency: "IDR", fundingId: "base:idrx", id: "idrx" },
  { currency: "ARS", fundingId: "base:wars", id: "wars" },
  { currency: "BRL", fundingId: "base:wbrl", id: "wbrl" },
  { currency: "COP", fundingId: "base:wcop", id: "wcop" },
] as const;

describe("direct portfolio cash assets", () => {
  test("funding-backed cash identities match their own verified Base contracts", () => {
    for (const { currency, fundingId, id } of fundingBackedCash) {
      const asset = verifiedLocalCashAssets[currency];
      const funding = BASE_FUNDING_ASSETS[fundingId];
      expect(asset.id).toBe(id);
      expect(asset.kind).toBe("erc20");
      expect(asset.assetKey).toBe(assetKeyForErc20(funding.address));
      expect(asset.contractAddress).toBe(funding.address);
      expect(asset.decimals).toBe(funding.decimals);
      expect(asset.symbol).toBe(funding.symbol);
      expect(asset.cashCurrency).toBe(funding.fiatCurrency);
      expect(asset.cashCurrency).toBe(currency);
    }
  });

  test("direct assets appear once, including the verified wBRL cash balance", () => {
    const assets = getDirectPortfolioAssets();
    expect(assets.map((asset) => asset.id)).toEqual([
      "eth", "usdc", ...investAssets.map((asset) => asset.id),
      "eurc", "idrx", "wars", "wbrl", "wcop",
    ]);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
    expect(new Set(assets.map((asset) => asset.assetKey)).size).toBe(assets.length);
    const addresses = assets.flatMap((asset) => asset.contractAddress ? [asset.contractAddress.toLowerCase()] : []);
    expect(new Set(addresses).size).toBe(addresses.length);
    const currencies = assets.flatMap((asset) => asset.cashCurrency ? [asset.cashCurrency] : []);
    expect(new Set(currencies).size).toBe(currencies.length);
    expect(assets.filter((asset) => asset.cashCurrency === "BRL").map((asset) => asset.contractAddress?.toLowerCase()))
      .toEqual(["0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0"]);
  });

  test("verified cash contract lookups distinguish each funding-backed currency", () => {
    for (const { currency, fundingId } of fundingBackedCash) {
      expect(verifiedCashCurrency(BASE_FUNDING_ASSETS[fundingId].address)).toBe(currency);
    }
    expect(verifiedCashCurrency("0x0000000000000000000000000000000000000001")).toBeNull();
  });
});
