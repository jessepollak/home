import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import {
  matchesMarketPriceAssetIdentity,
  resolveMarketPriceAssetIdentity,
} from "@/shared/invest/history-contract";

const dynamicId = "base:0x1111111111111111111111111111111111111111";

describe("market price asset identity", () => {
  test("resolves configured and canonical dynamic Base assets for read-only history", () => {
    const configured = investAssets.find((asset) => asset.id === "cbbtc")!;

    expect(resolveMarketPriceAssetIdentity("cbbtc")).toEqual({
      assetId: "cbbtc",
      chainId: 8453,
      contractAddress: configured.contractAddress,
    });
    expect(resolveMarketPriceAssetIdentity(dynamicId)).toEqual({
      assetId: dynamicId,
      chainId: 8453,
      contractAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(
      matchesMarketPriceAssetIdentity({
        id: dynamicId,
        chainId: 8453,
        contractAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe(true);
  });

  test("fails closed for other networks, malformed IDs, non-canonical case, and static aliases", () => {
    const configured = investAssets.find((asset) => asset.id === "cbbtc")!;

    expect(resolveMarketPriceAssetIdentity("ethereum:0x1111111111111111111111111111111111111111")).toBeNull();
    expect(resolveMarketPriceAssetIdentity("base:0x1111")).toBeNull();
    expect(resolveMarketPriceAssetIdentity("base:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(
      resolveMarketPriceAssetIdentity(
        `base:${configured.contractAddress.toLowerCase()}`,
      ),
    ).toBeNull();
    expect(
      matchesMarketPriceAssetIdentity({
        id: dynamicId,
        chainId: 1,
        contractAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });
});
