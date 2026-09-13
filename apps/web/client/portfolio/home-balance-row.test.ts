import { describe, expect, test } from "bun:test";
import type { HomeAssetBalanceItem } from "@/shared/portfolio/present-home-balances";
import { presentHomeBalanceMark } from "./home-balance-row";

const ASSET_KEY =
  "eip155:8453/erc20:0x9999999999999999999999999999999999999999";

function recognizedItem(
  overrides: Partial<HomeAssetBalanceItem> = {},
): HomeAssetBalanceItem {
  return {
    id: `asset:${ASSET_KEY}`,
    assetKey: ASSET_KEY,
    group: "asset",
    name: "Recognized Coin",
    detail: "RCG",
    displayBalance: "1.2300 RCG",
    currencyCode: null,
    recognized: true,
    ...overrides,
  };
}

describe("presentHomeBalanceMark", () => {
  test("uses the recognized Codex image before a secondary resolved image", () => {
    const mark = presentHomeBalanceMark(
      recognizedItem({ imageUrl: "https://images.example.test/codex.png" }),
      { images: { [ASSET_KEY]: "https://images.example.test/onchain.png" } },
    );

    expect(mark).toMatchObject({
      imageUrl: "https://images.example.test/codex.png",
      symbol: "RC",
      pending: false,
    });
  });

  test("falls back to the letter mark when no image source exists", () => {
    const mark = presentHomeBalanceMark(recognizedItem());

    expect(mark).toMatchObject({ imageUrl: null, symbol: "RC", pending: false });
  });
});
