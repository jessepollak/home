import { describe, expect, test } from "bun:test";
import { BASE_FUNDING_ASSETS } from "@/shared/assets/base";
import { cashCurrencyForContract } from "@/shared/currencies/registry";
import { requiredLocalCashAsset } from "@/shared/balances/fixtures";
import { investAssets } from "./invest-assets";
import {
  assertUniquePortfolioAssets,
  assetKeyForErc20,
  getDirectPortfolioAssets,
  portfolioVaults,
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
      const asset = requiredLocalCashAsset(currency);
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
      expect(cashCurrencyForContract(BASE_FUNDING_ASSETS[fundingId].address)).toBe(currency);
    }
    expect(cashCurrencyForContract("0x0000000000000000000000000000000000000001")).toBeNull();
  });

  test("keeps one entry per asset key and projected id", () => {
    const assets = getDirectPortfolioAssets();
    expect(() => assertUniquePortfolioAssets(assets)).not.toThrow();
    const [first, second] = assets;
    if (!first || !second) throw new Error("Missing direct portfolio assets.");
    expect(() => assertUniquePortfolioAssets([...assets, { ...second, assetKey: first.assetKey }])).toThrow();
    expect(() => assertUniquePortfolioAssets([...assets, { ...second, id: first.id }])).toThrow();
  });

  test("rejects a promoted currency that collides with a vault identity", () => {
    const vault = portfolioVaults[0];
    if (!vault) throw new Error("Missing portfolio vault.");
    const vaultEntries = portfolioVaults.map((entry) => ({ id: entry.id, assetKey: assetKeyForErc20(entry.address) }));
    expect(() => assertUniquePortfolioAssets([...getDirectPortfolioAssets(), ...vaultEntries])).not.toThrow();
    expect(() => assertUniquePortfolioAssets([
      ...getDirectPortfolioAssets(),
      ...vaultEntries,
      { id: vault.id, assetKey: assetKeyForErc20("0x9999999999999999999999999999999999999999") },
    ])).toThrow();
  });
});
