import { expect, test } from "bun:test";
import { moneyTickerAnimationsEnabled, splitMoneyTickerValue } from "./money-ticker";

const trickyValues = [
  "R$ 1.234,56",
  "Rp 78.123.456,00",
  "$0.0000001234",
  "−0,67 %",
] as const;

test("reduced motion disables digit transitions without suppressing value updates", () => {
  expect(moneyTickerAnimationsEnabled(true, true)).toBe(false);
  expect(moneyTickerAnimationsEnabled(true, false)).toBe(true);
});

test("formatted money values round-trip without numeric coercion", () => {
  for (const value of trickyValues) {
    const parts = splitMoneyTickerValue(value);
    expect(`${parts.prefix}${parts.numeric}${parts.suffix}`).toBe(value);
  }
});
