import type { RegionId } from "@/config/regions";
import {
  formatDecimalAmount,
  formatFiatAmount,
  presentationCurrencyMetadata,
} from "@/shared/formatting/money";
import type { ExactDecimal } from "@/shared/balances/types";

const integerPattern = /^-?(?:0|[1-9]\d*)$/;

export function formatFiatValue(
  value: ExactDecimal,
  currency: string,
  fractionDigits = 2,
  regionId: RegionId = "GLOBAL",
): string {
  const atoms = parseExactDecimal(value, fractionDigits);
  return `${currency} ${formatDecimalAmount(atoms, value.scale, {
    fractionDigits,
    regionId,
  })}`;
}

export function presentationCurrencyName(code: string): string {
  return presentationCurrencyMetadata(code).name;
}

export function presentationCurrencySymbol(code: string): string {
  return presentationCurrencyMetadata(code).symbol;
}

/** Presentation-only fiat value using the selected region's locale. */
export function formatPresentationFiat(
  value: ExactDecimal,
  currency: string,
  fractionDigits = 2,
  regionId?: RegionId,
): string {
  const atoms = parseExactDecimal(value, fractionDigits);
  return formatFiatAmount(atoms, value.scale, currency, {
    fractionDigits,
    regionId,
  });
}

/**
 * Attaches the configured currency presentation to an already-rounded canonical
 * amount (`4,812.40`, `<0.01`). Kept for callers that already own rounding.
 */
export function formatMoneyLabel(
  amount: string,
  currency: string,
  regionId?: RegionId,
): string {
  const negative = amount.startsWith("-") || amount.startsWith("−");
  const unsigned = negative ? amount.slice(1) : amount;
  const tiny = unsigned.startsWith("<");
  const canonical = (tiny ? unsigned.slice(1) : unsigned).replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(canonical);
  if (!match) throw new TypeError("The money label is invalid.");
  const fraction = match[2] ?? "";
  const atoms = BigInt(`${match[1]}${fraction}`);
  const signedAtoms = negative ? -atoms : atoms;
  const formatted = formatFiatAmount(signedAtoms, fraction.length, currency, {
    fractionDigits: fraction.length,
    markTiny: false,
    regionId,
  });
  if (!tiny) return formatted;
  return negative ? `−<${formatted.slice(1)}` : `<${formatted}`;
}

function parseExactDecimal(value: ExactDecimal, fractionDigits: number): bigint {
  if (
    !integerPattern.test(value.atoms) ||
    !Number.isSafeInteger(value.scale) ||
    value.scale < 0 ||
    !Number.isSafeInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 20
  ) {
    throw new TypeError("The fiat value is invalid.");
  }
  return BigInt(value.atoms);
}
