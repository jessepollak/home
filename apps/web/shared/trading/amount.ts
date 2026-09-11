const canonicalBaseUnitsPattern = /^(?:0|[1-9]\d*)$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

export function parseTradeAmount(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Invalid token decimals.");
  }

  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error("Invalid amount.");

  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error("Too many decimal places.");

  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const baseUnits = `${normalizedWhole}${fraction.padEnd(decimals, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  assertCanonicalTradeBaseUnits(baseUnits);
  if (BigInt(baseUnits) === BigInt(0)) throw new Error("Amount must be positive.");
  return baseUnits;
}

export function assertCanonicalTradeBaseUnits(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !canonicalBaseUnitsPattern.test(value) ||
    BigInt(value) > UINT256_MAX
  ) {
    throw new Error("Invalid base-unit amount.");
  }
}

export function formatTradeBaseUnits(value: string | bigint, decimals: number): string {
  const digits = typeof value === "bigint" ? value.toString() : value;
  assertCanonicalTradeBaseUnits(digits);
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
