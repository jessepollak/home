import { expect, test } from "bun:test";
import { compactFinancialValue } from "./compact-financial-value";

test("keeps familiar values and the twelve-integer-digit boundary unchanged", () => {
  expect(compactFinancialValue("$12,345.67")).toBe("$12,345.67");
  expect(compactFinancialValue("$999,999,999,999.99")).toBe("$999,999,999,999.99");
  expect(compactFinancialValue("99,999,999,999 RESERVE")).toBe("99,999,999,999 RESERVE");
  expect(compactFinancialValue("Unavailable")).toBe("Unavailable");
});

test("switches to six significant digits immediately above the boundary", () => {
  expect(compactFinancialValue("$1,000,000,000,000.00")).toBe("$1e12");
  expect(compactFinancialValue("$123,456,789,012,345,678,901,234.56")).toBe("$1.23457e23");
});

test("rounding carry advances the scientific exponent without floating-point coercion", () => {
  expect(compactFinancialValue("€999,999,999,999,999,999.99 EUR")).toBe("€1e18 EUR");
});
