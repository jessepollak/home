import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { atomicToDecimal, decimalToAtomic } from "./atomic";

const ATOMIC_PROPERTY_SEED = 191403;
const NUM_RUNS = 500;
const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const uint = fc.oneof(
  fc.constantFrom(BigInt(0), BigInt(1), BigInt(2), BigInt(1_000_000), BigInt(10) ** BigInt(18), UINT128_MAX),
  fc.bigInt({ min: BigInt(0), max: UINT128_MAX }),
);
const decimals = fc.integer({ min: 0, max: 18 });
const canonicalDecimal = decimals.chain((precision) =>
  fc.tuple(uint, fc.integer({ min: 0, max: precision })).chain(([whole, fractionLength]) =>
    fc.bigInt({ min: BigInt(0), max: BigInt(10) ** BigInt(fractionLength) - BigInt(1) }).map((fraction) => ({
      precision,
      value: fractionLength === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(fractionLength, "0")}`,
      atomic: whole * BigInt(10) ** BigInt(precision) + fraction * BigInt(10) ** BigInt(precision - fractionLength),
    })),
  ),
);
const atomic = fc.oneof(
  uint,
  fc.tuple(uint, fc.integer({ min: 0, max: 6 })).map(([value, leadingZeros]) => `${"0".repeat(leadingZeros)}${value}`),
);

describe("Atomic amount conversion properties", () => {
  test("canonical decimals round trip and reparse to the same exact atomic bigint", () => {
    fc.assert(
      fc.property(canonicalDecimal, ({ value, precision, atomic: expectedAtomic }) => {
        const parsed = decimalToAtomic(value, precision);
        expect(BigInt(parsed)).toBe(expectedAtomic);
        const formatted = atomicToDecimal(parsed, precision);
        expect(BigInt(decimalToAtomic(formatted, precision))).toBe(expectedAtomic);
      }),
      {
        seed: ATOMIC_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [
          [{ value: "0", precision: 0, atomic: BigInt(0) }],
          [{ value: "0.00", precision: 2, atomic: BigInt(0) }],
          [{ value: "1.230000", precision: 6, atomic: BigInt(1_230_000) }],
          [{ value: "0.000000000000000001", precision: 18, atomic: BigInt(1) }],
        ],
      },
    );
  });

  test("atomic strings and bigints round trip to their normalized integer value", () => {
    fc.assert(
      fc.property(atomic, decimals, (value, precision) => {
        expect(decimalToAtomic(atomicToDecimal(value, precision), precision)).toBe(BigInt(value).toString());
      }),
      {
        seed: ATOMIC_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [["000000", 18], ["000001", 6], [BigInt(2), 0], [UINT128_MAX, 18]],
      },
    );
  });

  test("decimal fractions beyond asset precision throw even for trailing zeros", () => {
    fc.assert(
      fc.property(uint, decimals, (whole, precision) => {
        expect(() => decimalToAtomic(`${whole}.${"0".repeat(precision + 1)}`, precision)).toThrow();
      }),
      { seed: ATOMIC_PROPERTY_SEED, numRuns: NUM_RUNS, examples: [[BigInt(0), 0], [BigInt(1), 18]] },
    );
  });

  test("decimal amounts with leading whole-number zeros throw", () => {
    fc.assert(
      fc.property(canonicalDecimal, ({ value, precision }) => {
        expect(() => decimalToAtomic(`0${value}`, precision)).toThrow();
      }),
      {
        seed: ATOMIC_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[{ value: "0", precision: 0, atomic: BigInt(0) }], [{ value: "1.0", precision: 1, atomic: BigInt(10) }]],
      },
    );
  });
});
