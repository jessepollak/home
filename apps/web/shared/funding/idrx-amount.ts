const idrxAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const maxIdrxAmountLength = "1000000000.00".length;

export const IDRX_MIN_TO_BE_MINTED_MINOR = BigInt(2_000_000);
export const IDRX_MAX_TO_BE_MINTED_MINOR = BigInt("100000000000");

export function parseIdrxMinorUnits(value: unknown): bigint | null {
  if (
    typeof value !== "string" ||
    value.length > maxIdrxAmountLength ||
    !idrxAmountPattern.test(value)
  ) {
    return null;
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function isAllowedIdrxMintAmount(value: unknown): value is string {
  const minor = parseIdrxMinorUnits(value);
  return minor !== null &&
    minor >= IDRX_MIN_TO_BE_MINTED_MINOR &&
    minor <= IDRX_MAX_TO_BE_MINTED_MINOR;
}
