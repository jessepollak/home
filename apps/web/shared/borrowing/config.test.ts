import { describe, expect, test } from "bun:test";
import { BORROW_MARKETS, DEFAULT_BORROW_MARKET, getBorrowMarketRef } from "./config";

describe("Borrow market registry", () => {
  test("launches only the verified USDC/cbBTC market with canonical asset identities", () => {
    expect(BORROW_MARKETS).toHaveLength(1);
    expect(DEFAULT_BORROW_MARKET).toMatchObject({ chainId: 8453, availability: "enabled", rank: 1 });
    expect(String(DEFAULT_BORROW_MARKET.loanToken.id)).toBe(`eip155:8453/erc20:${DEFAULT_BORROW_MARKET.loanToken.address.toLowerCase()}`);
    expect(String(DEFAULT_BORROW_MARKET.collateralToken.id)).toBe(`eip155:8453/erc20:${DEFAULT_BORROW_MARKET.collateralToken.address.toLowerCase()}`);
  });
  test("resolves configured ids case-insensitively and rejects arbitrary markets", () => {
    expect(getBorrowMarketRef(DEFAULT_BORROW_MARKET.marketId.toUpperCase())).toBe(DEFAULT_BORROW_MARKET);
    expect(getBorrowMarketRef(`0x${"00".repeat(32)}`)).toBeNull();
  });
});
