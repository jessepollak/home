import type { RegionId } from "@/config/regions";
import {
  formatFiatAmount,
  presentationCurrencyMetadata,
} from "@/shared/formatting/money";
import type { ExactDecimal } from "@/shared/balances/types";

const integerPattern = /^-?(?:0|[1-9]\d*)$/;

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
