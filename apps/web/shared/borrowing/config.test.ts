import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VERIFIED_MORPHO_MARKET,
  MORPHO_USDC_CBBTC_MARKET_PARAMS,
} from "@/shared/morpho-markets/config";
import {
  BORROW_MARKETS,
  BORROW_MARKET_PARAMS,
  DEFAULT_BORROW_MARKET,
  getBorrowMarketRef,
} from "./config";

describe("Borrow market registry", () => {
  test("launches only the verified USDC/cbBTC market with canonical asset identities", () => {
    expect(BORROW_MARKETS).toHaveLength(1);
    expect(DEFAULT_BORROW_MARKET).toMatchObject({
      chainId: 8453,
      availability: "enabled",
      capabilities: { borrow: "enabled" },
      rank: 1,
    });
    expect(String(DEFAULT_BORROW_MARKET.loanToken.id)).toBe(`eip155:8453/erc20:${DEFAULT_BORROW_MARKET.loanToken.address.toLowerCase()}`);
    expect(String(DEFAULT_BORROW_MARKET.collateralToken.id)).toBe(`eip155:8453/erc20:${DEFAULT_BORROW_MARKET.collateralToken.address.toLowerCase()}`);
  });
  test("keeps current Borrow constants compatible with the verified registry", () => {
    expect(DEFAULT_BORROW_MARKET.marketId).toBe(DEFAULT_VERIFIED_MORPHO_MARKET.marketId);
    expect(DEFAULT_BORROW_MARKET.morpho).toBe(DEFAULT_VERIFIED_MORPHO_MARKET.morpho);
    expect(BORROW_MARKET_PARAMS).toBe(MORPHO_USDC_CBBTC_MARKET_PARAMS);
  });
  test("resolves configured ids case-insensitively and rejects arbitrary markets", () => {
    expect(getBorrowMarketRef(DEFAULT_BORROW_MARKET.marketId.toUpperCase())).toBe(DEFAULT_BORROW_MARKET);
    expect(getBorrowMarketRef(`0x${"00".repeat(32)}`)).toBeNull();
  });
});
