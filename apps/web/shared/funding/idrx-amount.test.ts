import { describe, expect, test } from "bun:test";
import {
  IDRX_MAX_TO_BE_MINTED_MINOR,
  isAllowedIdrxMintAmount,
  parseIdrxMinorUnits,
} from "./idrx-amount";

describe("IDRX amount validation", () => {
  test("uses exact minor units for decimal-equivalent amounts", () => {
    expect(parseIdrxMinorUnits("20000")).toBe(BigInt(2_000_000));
    expect(parseIdrxMinorUnits("20000.0")).toBe(BigInt(2_000_000));
    expect(parseIdrxMinorUnits("20000.00")).toBe(BigInt(2_000_000));
  });

  test("accepts the exact cap and rejects fractional overflow or malformed values", () => {
    expect(parseIdrxMinorUnits("1000000000")).toBe(IDRX_MAX_TO_BE_MINTED_MINOR);
    expect(isAllowedIdrxMintAmount("1000000000")).toBe(true);
    expect(isAllowedIdrxMintAmount("1000000000.00")).toBe(true);
    expect(isAllowedIdrxMintAmount("1000000000.01")).toBe(false);
    expect(isAllowedIdrxMintAmount("999999999999999999999999999999")).toBe(false);
    expect(isAllowedIdrxMintAmount("20000.001")).toBe(false);
    expect(isAllowedIdrxMintAmount("2e4")).toBe(false);
  });
});
