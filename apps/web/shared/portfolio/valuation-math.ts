import type { ExactDecimal } from "./valuation-types";

export type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

const decimalPattern = /^((?:0|[1-9]\d*))(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const canonicalIntegerPattern = /^(?:0|[1-9]\d*)$/;

export function parseExactDecimal(value: string): ExactDecimal | null {
  if (value !== value.trim()) return null;
  const match = decimalPattern.exec(value);
  if (!match) return null;

  const mantissa = match[1] ?? "";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) return null;

  let digits = `${mantissa}${fraction}`.replace(/^0+(?=\d)/, "");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > 1_000) return null;
  if (!digits || !/[1-9]/.test(digits)) digits = "0";
  return { atoms: digits, scale };
}

export function exactDecimalToFraction(value: ExactDecimal): Fraction {
  assertExactDecimal(value);
  return reduce({
    numerator: BigInt(value.atoms),
    denominator: powerOfTen(value.scale),
  });
}

export function baseUnitsToFraction(baseUnits: string, decimals: number): Fraction {
  if (!canonicalIntegerPattern.test(baseUnits)) {
    throw new TypeError("Base units must be a canonical non-negative integer.");
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TypeError("Token decimals are invalid.");
  }
  return reduce({ numerator: BigInt(baseUnits), denominator: powerOfTen(decimals) });
}

export function multiplyFractions(...values: readonly Fraction[]): Fraction {
  return values.reduce(
    (result, value) =>
      reduce({
        numerator: result.numerator * value.numerator,
        denominator: result.denominator * value.denominator,
      }),
    { numerator: BigInt(1), denominator: BigInt(1) },
  );
}

export function divideFractions(dividend: Fraction, divisor: Fraction): Fraction {
  assertFraction(dividend);
  assertFraction(divisor);
  if (divisor.numerator === BigInt(0)) throw new TypeError("Cannot divide by zero.");
  return reduce({
    numerator: dividend.numerator * divisor.denominator,
    denominator: dividend.denominator * divisor.numerator,
  });
}

export function addFractions(values: readonly Fraction[]): Fraction {
  return values.reduce(
    (result, value) => {
      assertFraction(value);
      return reduce({
        numerator:
          result.numerator * value.denominator +
          value.numerator * result.denominator,
        denominator: result.denominator * value.denominator,
      });
    },
    { numerator: BigInt(0), denominator: BigInt(1) },
  );
}

export function roundFractionToExactDecimal(
  value: Fraction,
  scale = 18,
): ExactDecimal {
  assertFraction(value);
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 100) {
    throw new TypeError("Decimal scale is invalid.");
  }
  const scaledNumerator = value.numerator * powerOfTen(scale);
  const quotient = scaledNumerator / value.denominator;
  const remainder = scaledNumerator % value.denominator;
  const doubled = remainder * BigInt(2);
  const rounded =
    doubled > value.denominator ||
    (doubled === value.denominator && quotient % BigInt(2) === BigInt(1))
      ? quotient + BigInt(1)
      : quotient;
  return { atoms: rounded.toString(10), scale };
}

export function roundFractionPreservingPositive(
  value: Fraction,
  minimumScale = 18,
  maximumScale = 100,
): ExactDecimal {
  assertFraction(value);
  if (
    !Number.isSafeInteger(minimumScale) ||
    !Number.isSafeInteger(maximumScale) ||
    minimumScale < 0 ||
    maximumScale < minimumScale ||
    maximumScale > 100
  ) {
    throw new TypeError("Decimal scale range is invalid.");
  }
  for (let scale = minimumScale; scale <= maximumScale; scale += 1) {
    const rounded = roundFractionToExactDecimal(value, scale);
    if (value.numerator === BigInt(0) || BigInt(rounded.atoms) > BigInt(0)) {
      return rounded;
    }
  }
  return { atoms: "1", scale: maximumScale };
}

export function isZeroFraction(value: Fraction): boolean {
  assertFraction(value);
  return value.numerator === BigInt(0);
}

function reduce(value: Fraction): Fraction {
  assertFraction(value);
  if (value.numerator === BigInt(0)) return { numerator: BigInt(0), denominator: BigInt(1) };
  const divisor = gcd(value.numerator, value.denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  };
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b !== BigInt(0)) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || BigInt(1);
}

function powerOfTen(scale: number): bigint {
  return BigInt(10) ** BigInt(scale);
}

function assertExactDecimal(value: ExactDecimal): void {
  if (
    !canonicalIntegerPattern.test(value.atoms) ||
    !Number.isSafeInteger(value.scale) ||
    value.scale < 0 ||
    value.scale > 1_000
  ) {
    throw new TypeError("Exact decimal is invalid.");
  }
}

function assertFraction(value: Fraction): void {
  if (value.denominator <= BigInt(0) || value.numerator < BigInt(0)) {
    throw new TypeError("Fraction must be non-negative with a positive denominator.");
  }
}
