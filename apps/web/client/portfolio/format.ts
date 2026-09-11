const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;

/**
 * Formats integer token base units without floating-point conversion or rounding.
 * Tiny positive balances remain visibly positive.
 */
export function formatBaseUnitAmount(
  balanceBaseUnits: string,
  decimals: number,
): string {
  if (!decimalIntegerPattern.test(balanceBaseUnits)) {
    throw new TypeError("balanceBaseUnits must be a canonical decimal integer.");
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TypeError("decimals must be an integer from 0 through 255.");
  }
  if (decimals === 0) {
    return balanceBaseUnits;
  }

  const padded = balanceBaseUnits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole;
}
