import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { parseUsdcAmount } from "@/client/savings/format";
import { parseDecimalAmount, parsePositiveAmount, readPositiveDecimal } from "@/shared/amounts/decimal";
import { atomicToDecimal, decimalToAtomic } from "@/shared/formatting/atomic";
import { parseTokenAmount } from "@/shared/morpho-markets/math";
import { parseTradeAmount } from "@/shared/trading/amount";
import { parseTransferAmount } from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError } from "@/shared/transfers/types";

const options = { seed: 191405, numRuns: 200 };
const atoms = fc.bigInt({ min: BigInt(1), max: BigInt(10) ** BigInt(36) - BigInt(1) });
const precision = fc.integer({ min: 0, max: 36 });
const adapters = [
  { name: "transfer", parse: parseTransferAmount, precision, failure: TransferExecutionError },
  { name: "Morpho", parse: (value: string, decimals: number) => parseTokenAmount(value, decimals).toString(10), precision, failure: TypeError },
  { name: "savings", parse: parseUsdcAmount, precision: fc.constant(6), failure: Error },
  { name: "trade", parse: parseTradeAmount, precision, failure: null },
  { name: "decimalToAtomic", parse: decimalToAtomic, precision, failure: Error },
];

function canonicalDecimal(value: bigint, decimals: number): string {
  const digits = value.toString(10).padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -decimals)}.${fraction}` : digits.slice(0, -decimals);
}

const invalidDecimal = fc.tuple(
  fc.integer({ min: 1, max: 1_000_000 }),
  fc.constantFrom("negative", "exponent", "comma", "multiple-dots", "empty", "missing-whole"),
).map(([value, kind]) => {
  switch (kind) {
    case "negative": return `-${value}`;
    case "exponent": return `${value}e2`;
    case "comma": return `${value},000`;
    case "multiple-dots": return `${value}.2.3`;
    case "empty": return "";
    default: return ".5";
  }
});

describe("shared decimal adapters", () => {
  for (const adapter of adapters) {
    test(`${adapter.name} preserves generated canonical decimals exactly`, () => {
      fc.assert(fc.property(atoms, adapter.precision, (value, decimals) => {
        const decimal = canonicalDecimal(value, decimals);
        const expected = parsePositiveAmount(decimal, decimals);
        expect(expected).toBe(value);
        expect(adapter.parse(decimal, decimals)).toBe(expected.toString(10));
      }), options);
    });

    test(`${adapter.name} never returns a value for generated invalid input`, () => {
      fc.assert(fc.property(invalidDecimal, adapter.precision, (value, decimals) => {
        if (adapter.failure === null) expect(adapter.parse(value, decimals)).toBeNull();
        else expect(() => adapter.parse(value, decimals)).toThrow(adapter.failure);
      }), options);
    });
  }

  test("atomicToDecimal round-trips bounded base units through the shared parser", () => {
    fc.assert(fc.property(atoms, precision, (value, decimals) => {
      const decimal = atomicToDecimal(value, decimals);
      expect(decimal).toBe(canonicalDecimal(value, decimals));
      expect(atomicToDecimal(`000${value}`, decimals)).toBe(decimal);
      expect(parseDecimalAmount(decimal, decimals)).toBe(value);
    }), options);
  });

  test("atomicToDecimal rejects invalid atomic input instead of returning a value", () => {
    fc.assert(fc.property(invalidDecimal, precision, (value, decimals) => {
      expect(() => atomicToDecimal(value, decimals)).toThrow(new Error("Atomic amount is invalid."));
    }), options);
  });

  test("readPositiveDecimal retains canonical decimals that round-trip to base units", () => {
    fc.assert(fc.property(atoms, precision, (value, decimals) => {
      const decimal = canonicalDecimal(value, decimals);
      const read = readPositiveDecimal(decimal);
      if (read === null) throw new Error("Canonical decimals must be readable.");
      expect(read).toBe(decimal);
      expect(parsePositiveAmount(read, decimals)).toBe(value);
    }), options);
  });

  test("readPositiveDecimal rejects generated malformed inputs instead of returning a value", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), (value) => {
      for (const invalid of [`-${value}`, `${value},000`, `${value}.2.3`, `0${value}`, ` ${value}`]) {
        expect(readPositiveDecimal(invalid)).toBeNull();
      }
    }), options);
  });
});
