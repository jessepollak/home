import { describe, expect, test } from "bun:test";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { BORROW_MARKETS, getBorrowMarketRef } from "./config";

describe("Borrow market registry", () => {
  test("projects every approved market with its canonical identity and capability", () => {
    expect(BORROW_MARKETS).toHaveLength(5);
    for (const [index, expected] of VERIFIED_MORPHO_MARKETS.entries()) {
      const market = BORROW_MARKETS[index];
      expect(market).toMatchObject({
        chainId: 8453, marketId: expected.marketId, collateralToken: expected.collateralToken,
        loanToken: expected.loanToken, oracle: expected.oracle, irm: expected.irm,
        lltvWad: expected.lltvWad, rank: index + 1, availability: "enabled",
        capabilities: { borrow: "enabled" },
      });
      expect(String(market.loanToken.id)).toBe(`eip155:8453/erc20:${market.loanToken.address.toLowerCase()}`);
      expect(String(market.collateralToken.id)).toBe(`eip155:8453/erc20:${market.collateralToken.address.toLowerCase()}`);
      expect(getBorrowMarketRef(expected.marketId.toUpperCase())?.rank).toBe(index + 1);
    }
    expect(getBorrowMarketRef(`0x${"00".repeat(32)}`)).toBeNull();
  });
});
