import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VERIFIED_MORPHO_MARKET,
  VERIFIED_MORPHO_MARKETS,
  getVerifiedMorphoMarket,
} from "./config";

describe("verified Morpho market registry", () => {
  test("requires every market to approve at least one product capability", () => {
    expect(VERIFIED_MORPHO_MARKETS.length).toBeGreaterThan(0);
    for (const market of VERIFIED_MORPHO_MARKETS) {
      expect(Object.keys(market.capabilities).length).toBeGreaterThan(0);
      expect(Object.values(market.capabilities).every(
        (capability) => capability === "enabled" || capability === "reducing-only",
      )).toBe(true);
    }
  });

  test("approves the current USDC/cbBTC market for Borrow", () => {
    expect(DEFAULT_VERIFIED_MORPHO_MARKET.capabilities).toEqual({
      borrow: "enabled",
    });
    expect(getVerifiedMorphoMarket(DEFAULT_VERIFIED_MORPHO_MARKET.marketId.toUpperCase()))
      .toBe(DEFAULT_VERIFIED_MORPHO_MARKET);
    expect(getVerifiedMorphoMarket(`0x${"00".repeat(32)}`)).toBeNull();
  });
});
