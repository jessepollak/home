import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  DecimalAmountError,
  type DecimalAmountFailure,
  formatDecimalAmount,
  parseDecimalAmount,
  parsePositiveAmount,
  readPositiveDecimal,
  UINT256_MAX,
} from "./decimal";

const DECIMAL_AMOUNT_PROPERTY_SEED = 191404;
const NUM_RUNS = 500;
const UINT256_MAX_DECIMAL = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const amount = fc.oneof(
  fc.constantFrom(BigInt(0), BigInt(1), UINT256_MAX),
  fc.bigInt({ min: BigInt(0), max: UINT256_MAX }),
);
const decimals = fc.integer({ min: 0, max: 255 });
const canonicalDecimal = decimals.chain((precision) =>
  fc.tuple(amount, fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: precision }))
    .map(([whole, digits]) => {
      const fraction = digits.join("").replace(/0+$/, "");
      return {
        value: fraction ? `${whole.toString()}.${fraction}` : whole.toString(),
        decimals: precision,
      };
    }),
);

function expectFailure(operation: () => unknown, reason: DecimalAmountFailure, message: string): void {
  let failure: unknown;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DecimalAmountError);
  expect(failure).toBeInstanceOf(TypeError);
  expect(failure).toMatchObject({ reason, message });
}

describe("parseDecimalAmount", () => {
  test.each([
    ["1.234567", 6, "1234567"],
    ["0.000000000000000001", 18, "1"],
    ["42", 0, "42"],
    ["0", 6, "0"],
    ["0.000", 3, "0"],
  ])("parses %s at %s decimals exactly", (value, precision, expected) => {
    expect(parseDecimalAmount(value, precision)).toBe(BigInt(expected));
  });

  test.each([
    "", " ", "\t", "\n", " 1", "1 ", "1\n", "+1", "-1", "-0", "1e3", "1E3", "1,000",
    "01", "00", "01.2", ".", "1.", ".5", "1 2", "1.2.3",
  ])("rejects invalid decimal syntax %j", (value) => {
    expectFailure(() => parseDecimalAmount(value, 6), "invalid", "Decimal amount is invalid.");
  });

  test.each([
    ["0.5", 0],
    ["1.0000001", 6],
    ["1.00", 1],
  ])("rejects excess precision in %s at %s decimals without rounding", (value, precision) => {
    expectFailure(
      () => parseDecimalAmount(value, precision),
      "precision",
      "Decimal amount exceeds the asset precision.",
    );
  });

  test("allows exact amounts beyond uint256 at the nonnegative parsing boundary", () => {
    const value = UINT256_MAX + BigInt(1);
    expect(parseDecimalAmount(value.toString(), 0)).toBe(value);
  });
});

describe("parsePositiveAmount", () => {
  test("parses a positive fractional amount exactly", () => {
    expect(parsePositiveAmount("1.234567", 6)).toBe(BigInt("1234567"));
  });

  test.each([["0", 0], ["0.000", 3]])("rejects zero %s at %s decimals", (value, precision) => {
    expectFailure(() => parsePositiveAmount(value, precision), "zero", "Amount must be greater than zero.");
  });

  test("accepts the exact uint256 maximum", () => {
    expect(UINT256_MAX).toBe(BigInt(UINT256_MAX_DECIMAL));
    expect(parsePositiveAmount(UINT256_MAX_DECIMAL, 0)).toBe(BigInt(UINT256_MAX_DECIMAL));
  });

  test("rejects uint256 overflow", () => {
    expectFailure(
      () => parsePositiveAmount((UINT256_MAX + BigInt(1)).toString(), 0),
      "overflow",
      "Amount exceeds the maximum supported value.",
    );
  });
});

describe("asset decimals validation", () => {
  test.each([-1, 1.5, 256, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid decimals %s at every boundary",
    (precision) => {
      for (const operation of [
        () => parseDecimalAmount("1", precision),
        () => parsePositiveAmount("1", precision),
        () => formatDecimalAmount(BigInt(1), precision),
      ]) {
        expectFailure(operation, "decimals", "Asset decimals must be an integer between 0 and 255.");
      }
    },
  );
});

describe("formatDecimalAmount", () => {
  test.each([
    ["1230000", 6, "1.23"],
    ["0", 6, "0"],
    ["42", 0, "42"],
    ["1", 18, "0.000000000000000001"],
  ])("formats %s base units at %s decimals exactly", (value, precision, expected) => {
    expect(formatDecimalAmount(BigInt(value), precision)).toBe(expected);
  });

  test("rejects negative amounts", () => {
    expectFailure(() => formatDecimalAmount(BigInt(-1), 6), "invalid", "Amount must not be negative.");
  });

  test("canonicalizes a parsed decimal with trailing fractional zeros", () => {
    expect(formatDecimalAmount(parseDecimalAmount("1.2300", 6), 6)).toBe("1.23");
  });
});

describe("readPositiveDecimal", () => {
  test.each(["1", "0.000001", "12.3400", "1e3", "1E+3", "1.25e-999", "0.01E10"])(
    "preserves positive decimal and exponent string %s",
    (value) => {
      expect(readPositiveDecimal(value)).toBe(value);
    },
  );

  test.each([
    "0", "0.000", "0e10", "0.0E-10", "01", "00.1", "01e3", " 1", "1 ", "1\n",
    "", ".5", "1.", "-1", "+1", "1,000", "1.2.3", "NaN", "Infinity",
  ])("rejects nonpositive or malformed string %j", (value) => {
    expect(readPositiveDecimal(value)).toBeNull();
  });

  test.each([[1, "1"], [0.125, "0.125"], [1e21, "1e+21"], [5e-324, "5e-324"]])(
    "reads finite positive number %s",
    (value, expected) => {
      expect(readPositiveDecimal(value)).toBe(expected);
    },
  );

  test.each([0, -0, -1, NaN, Infinity, -Infinity, null, undefined, true, {}, BigInt(1)])(
    "rejects invalid number or non-decimal value %s",
    (value) => {
      expect(readPositiveDecimal(value)).toBeNull();
    },
  );
});

describe("decimal amount properties", () => {
  test("format then parse preserves every base unit without rounding", () => {
    fc.assert(
      fc.property(amount, decimals, (value, precision) => {
        const formatted = formatDecimalAmount(value, precision);
        expect(parseDecimalAmount(formatted, precision)).toBe(value);
        expect(formatted).not.toMatch(/[eE]/);
        expect(formatted).not.toMatch(/\.[0-9]*0$/);
      }),
      {
        seed: DECIMAL_AMOUNT_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [
          [BigInt(0), 0], [BigInt(0), 255], [BigInt(1), 0], [BigInt(1), 255],
          [UINT256_MAX, 0], [UINT256_MAX, 255],
        ],
      },
    );
  });

  test("parse then format preserves independently generated canonical decimal strings", () => {
    fc.assert(
      fc.property(canonicalDecimal, ({ value, decimals: precision }) => {
        expect(formatDecimalAmount(parseDecimalAmount(value, precision), precision)).toBe(value);
      }),
      {
        seed: DECIMAL_AMOUNT_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [
          [{ value: "0", decimals: 0 }],
          [{ value: "1", decimals: 0 }],
          [{ value: UINT256_MAX_DECIMAL, decimals: 0 }],
          [{ value: `0.${"0".repeat(254)}1`, decimals: 255 }],
        ],
      },
    );
  });
});
