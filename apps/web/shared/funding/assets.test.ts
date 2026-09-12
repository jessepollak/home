import { describe, expect, test } from "bun:test";
import { presentationRegions } from "@/config/regions";
import { FUNDING_CHAIN_ID, fundingAssets, getFundingAsset } from "./assets";

const regionByAsset = {
  "base:usdc": "US",
  "base:wars": "AR",
  "base:wcop": "CO",
  "base:idrx": "ID",
} as const;

describe("funding asset registry", () => {
  test("locks canonical Base addresses, decimals, symbols, and issuer docs", () => {
    expect(fundingAssets).toEqual({
      "base:usdc": expect.objectContaining({
        chainId: 8453,
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        symbol: "USDC",
      }),
      "base:wars": expect.objectContaining({
        chainId: 8453,
        address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
        decimals: 18,
        symbol: "wARS",
      }),
      "base:wcop": expect.objectContaining({
        chainId: 8453,
        address: "0x8a1d45e102e886510e891d2ec656a708991e2d76",
        decimals: 18,
        symbol: "wCOP",
      }),
      "base:idrx": expect.objectContaining({
        chainId: 8453,
        address: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
        decimals: 2,
        symbol: "IDRX",
      }),
    });
    for (const asset of Object.values(fundingAssets)) {
      expect(asset.chainId).toBe(FUNDING_CHAIN_ID);
      expect(new URL(asset.issuerDocsUrl).protocol).toBe("https:");
    }
  });

  test("returns only own registry properties", () => {
    expect(getFundingAsset("base:idrx")?.symbol).toBe("IDRX");
    expect(getFundingAsset("toString")).toBeUndefined();
    expect(getFundingAsset("__proto__")).toBeUndefined();
  });

  test("agrees with regional fiat and candidate-asset defaults", () => {
    for (const [assetId, regionId] of Object.entries(regionByAsset)) {
      const asset = fundingAssets[assetId as keyof typeof fundingAssets];
      const region = presentationRegions[regionId];
      expect(region.currency.code).toBe(asset.fiatCurrency);
      expect(region.candidateAsset?.symbol).toBe(asset.symbol);
    }
  });
});
