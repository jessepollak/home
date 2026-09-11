import { describe, expect, test } from "bun:test";
import {
  addFractions,
  baseUnitsToFraction,
  exactDecimalToFraction,
  multiplyFractions,
  parseExactDecimal,
  roundFractionPreservingPositive,
  roundFractionToExactDecimal,
} from "./valuation-math";

describe("exact portfolio valuation math", () => {
  test("parses decimal and exponent lexemes without floating point", () => {
    expect(parseExactDecimal("0.000000000000000000123456789")).toEqual({
      atoms: "123456789",
      scale: 27,
    });
    expect(parseExactDecimal("1.25e3")).toEqual({ atoms: "1250", scale: 0 });
    expect(parseExactDecimal("1e-6")).toEqual({ atoms: "1", scale: 6 });
    expect(parseExactDecimal(" 1")).toBeNull();
    expect(parseExactDecimal("-1")).toBeNull();
  });

  test("sums exact fractions before one half-even rounding step", () => {
    const oneThird = multiplyFractions(
      baseUnitsToFraction("1", 0),
      exactDecimalToFraction({ atoms: "1", scale: 0 }),
      { numerator: BigInt(1), denominator: BigInt(3) },
    );
    const total = addFractions([oneThird, oneThird]);
    expect(roundFractionToExactDecimal(total, 2)).toEqual({
      atoms: "67",
      scale: 2,
    });
    expect(roundFractionToExactDecimal({ numerator: BigInt(5), denominator: BigInt(2) }, 0)).toEqual({
      atoms: "2",
      scale: 0,
    });
    expect(
      roundFractionPreservingPositive({
        numerator: BigInt(1),
        denominator: BigInt(10) ** BigInt(19),
      }),
    ).toEqual({ atoms: "1", scale: 19 });
    expect(
      roundFractionPreservingPositive({ numerator: BigInt(0), denominator: BigInt(1) }),
    ).toEqual({ atoms: "0", scale: 18 });
  });
});
