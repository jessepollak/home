import { describe, expect, test } from "bun:test";
import { atomicToDecimal, decimalToAtomic } from "./atomic";

describe("atomic amount formatting", () => {
  test("converts decimal amounts to exact atomic strings", () => {
    const cases = [
      { value: "0", decimals: 0, expected: "0" },
      { value: "42", decimals: 0, expected: "42" },
      { value: "0.000001", decimals: 6, expected: "1" },
      { value: "1.230000", decimals: 6, expected: "1230000" },
      { value: "1", decimals: 18, expected: "1000000000000000000" },
    ] as const;
    for (const scenario of cases) {
      expect(decimalToAtomic(scenario.value, scenario.decimals)).toBe(scenario.expected);
    }
  });

  test("formats atomic strings and bigints without losing precision", () => {
    const cases = [
      { value: "000000", decimals: 6, expected: "0" },
      { value: "000001", decimals: 6, expected: "0.000001" },
      { value: "1230000", decimals: 6, expected: "1.23" },
      { value: BigInt("1000000000000000001"), decimals: 18, expected: "1.000000000000000001" },
      { value: "42", decimals: 0, expected: "42" },
    ] as const;
    for (const scenario of cases) {
      expect(atomicToDecimal(scenario.value, scenario.decimals)).toBe(scenario.expected);
    }
  });

  test("rejects invalid, negative, and over-precision amounts", () => {
    for (const [value, decimals] of [["1.0000001", 6], ["-1", 6], ["01", 6], ["1.0", 0]] as const) {
      expect(() => decimalToAtomic(value, decimals)).toThrow();
    }
    expect(() => atomicToDecimal("-1", 6)).toThrow();
    expect(() => atomicToDecimal(BigInt(-1), 6)).toThrow();
  });
});
