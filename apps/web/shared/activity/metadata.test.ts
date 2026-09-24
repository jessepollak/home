import { describe, expect, test } from "bun:test";
import { sanitizeDynamicActivityTokenMetadata } from "./metadata";

describe("dynamic activity token metadata", () => {
  test.each([
    ["ZORA", "ZORA"],
    ["WETH", "WETH"],
    ["cbETH", "cbETH"],
    ["wstETH", "wstETH"],
    ["USDbC", "USDbC"],
    ["USDC.e", "USDC.e"],
    ["USD+", "USD+"],
    ["AERO", "AERO"],
    ["DAI", "DAI"],
    ["0xBTC", "0xBTC"],
    ["BRETT", "BRETT"],
    ["VIRTUAL", "VIRTUAL"],
    ["EURe", "EURe"],
    [" ZORA ", "ZORA"],
  ])("accepts %p as %p", (symbol, expected) => {
    expect(sanitizeDynamicActivityTokenMetadata({ symbol, decimals: 18 })).toEqual({
      assetId: null,
      tokenSymbol: expected,
      tokenDecimals: 18,
    });
  });

  test.each([
    "usdc",
    "USDC",
    "U5DC",
    "USDC-",
    "U.S.D.C",
    "USDС",
    "ЕТН",
    "ETH",
    "E.T.H",
    "cbBTC",
    "CB8TC",
    "USDC-vault",
    "USDC_vault",
    "USDCvault",
    "USDCVAULT",
    "TOSHl",
    "ArnZNc",
    "claim.xyz",
    "usdc.com",
    "www.claim",
    "https://x.io",
    "visit site",
    "$ZORA",
    "0x4444444444444444444444444444444444444444",
    "0X44444444",
    "0XDEADBEEF",
    "ABCDEFGHIJKLMNOPQ",
    "ＵＳＤＣ",
    "🚀",
    "BAD\u0001",
    "BAD\u0085",
    "BAD\u2028",
    "BAD\u2029",
    "BAD\u202e",
    "BAD\u200b",
    "\u200bZORA",
  ])("rejects %p", (symbol) => {
    expect(sanitizeDynamicActivityTokenMetadata({ symbol, decimals: 18 })).toEqual({
      assetId: null,
      tokenSymbol: null,
      tokenDecimals: null,
    });
  });
});
