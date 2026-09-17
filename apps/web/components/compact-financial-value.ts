const LARGE_VALUE_INTEGER_DIGITS = 12;
const SCIENTIFIC_SIGNIFICANT_DIGITS = 6;

/**
 * Keeps everyday monetary values familiar, while abbreviating values whose
 * integer part would dominate a mobile row. The input remains the source of
 * truth and should still be supplied as the accessible label.
 */
export function compactFinancialValue(
  value: string,
  integerDigitLimit = LARGE_VALUE_INTEGER_DIGITS,
  significantDigits = SCIENTIFIC_SIGNIFICANT_DIGITS,
): string {
  const match = /([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(value);
  if (!match || significantDigits < 2) return value;

  const token = match[1];
  const [groupedWhole, fraction = ""] = token.split(".");
  const whole = groupedWhole.replace(/,/g, "");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return value;

  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  if (normalizedWhole.length <= integerDigitLimit) return value;

  const allDigits = `${normalizedWhole}${fraction}`;
  let leading = allDigits.slice(0, significantDigits);
  const roundUp = Number(allDigits[significantDigits] ?? "0") >= 5;
  if (roundUp) leading = (BigInt(leading) + BigInt(1)).toString();

  let exponent = normalizedWhole.length - 1;
  if (leading.length > significantDigits) {
    exponent += 1;
    leading = leading.slice(0, significantDigits);
  }

  const trailing = leading.slice(1).replace(/0+$/, "");
  const mantissa = trailing ? `${leading[0]}.${trailing}` : leading[0];
  const compact = `${mantissa}e${exponent}`;
  return `${value.slice(0, match.index)}${compact}${value.slice(match.index + token.length)}`;
}
