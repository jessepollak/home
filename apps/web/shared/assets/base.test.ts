import { describe, expect, test } from "bun:test";
import {
  BASE_CBBTC,
  BASE_CHAIN_ID,
  BASE_ETH,
  BASE_FUNDING_ASSETS,
  BASE_MORPHO_USDC_VAULTS,
  BASE_USDC,
} from "./base";

describe("Base asset catalog", () => {
  test("keeps canonical assets and funding IDs unique", () => {
    expect(BASE_CHAIN_ID).toBe(8453);
    expect(BASE_ETH.decimals).toBe(18);
    expect(BASE_USDC.decimals).toBe(6);
    expect(BASE_CBBTC.decimals).toBe(8);
    expect(new Set(BASE_MORPHO_USDC_VAULTS.map(({ address }) => address.toLowerCase())).size).toBe(3);
    expect(Object.keys(BASE_FUNDING_ASSETS)).toEqual([
      "base:usdc",
      "base:wars",
      "base:wcop",
      "base:idrx",
    ]);
    expect(BASE_FUNDING_ASSETS["base:usdc"]).toMatchObject({
      address: BASE_USDC.address,
      decimals: BASE_USDC.decimals,
      symbol: BASE_USDC.symbol,
    });
  });
});
