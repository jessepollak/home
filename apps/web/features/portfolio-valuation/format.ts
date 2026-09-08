import { presentationRegions } from "@/config/regions";
import type { ExactDecimal } from "@/server/valuation/types";

const integerPattern = /^(?:0|[1-9]\d*)$/;
const prefixSymbols = new Set(["$", "£", "€", "₺", "₦"]);
const decimalCommaCurrencies = new Set(["BRL"]);

export function formatFiatValue(
  value: ExactDecimal,
  currency: string,
  fractionDigits = 2,
): string {
  if (
    !integerPattern.test(value.atoms) ||
    !Number.isSafeInteger(value.scale) ||
    value.scale < 0 ||
    !Number.isSafeInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 6
  ) {
    throw new TypeError("The fiat value is invalid.");
  }
  const atoms = BigInt(value.atoms);
  const rounded = roundAtoms(atoms, value.scale, fractionDigits);
  if (atoms > BigInt(0) && rounded === BigInt(0)) {
    const threshold =
      fractionDigits === 0 ? "1" : `0.${"0".repeat(fractionDigits - 1)}1`;
    return `${currency} <${threshold}`;
  }
  const divisor = BigInt(10) ** BigInt(fractionDigits);
  const whole = rounded / divisor;
  const fraction = (rounded % divisor).toString().padStart(fractionDigits, "0");
  const grouped = groupDigits(whole.toString(10));
  return `${currency} ${grouped}${fractionDigits > 0 ? `.${fraction}` : ""}`;
}

function roundAtoms(atoms: bigint, scale: number, targetScale: number): bigint {
  if (scale <= targetScale) return atoms * BigInt(10) ** BigInt(targetScale - scale);
  const divisor = BigInt(10) ** BigInt(scale - targetScale);
  const quotient = atoms / divisor;
  const remainder = atoms % divisor;
  const doubled = remainder * BigInt(2);
  return doubled > divisor || (doubled === divisor && quotient % BigInt(2) === BigInt(1))
    ? quotient + BigInt(1)
    : quotient;
}

export function presentationCurrencyName(code: string): string {
  for (const region of Object.values(presentationRegions)) {
    if (region.currency.code === code) return region.currency.name;
  }
  return code;
}

export function presentationCurrencySymbol(code: string): string {
  for (const region of Object.values(presentationRegions)) {
    if (region.currency.code === code && region.currency.symbol) {
      return region.currency.symbol;
    }
  }
  return code;
}

/**
 * Presentation-only money label. Rounding stays in `formatFiatValue`;
 * this swaps ISO codes for everyday symbols (and Brazilian decimal commas).
 */
export function formatPresentationFiat(
  value: ExactDecimal,
  currency: string,
  fractionDigits = 2,
): string {
  const labeled = formatFiatValue(value, currency, fractionDigits);
  const amount = labeled.slice(currency.length).trim();
  const localized = decimalCommaCurrencies.has(currency)
    ? localizeDecimalComma(amount)
    : amount;
  const symbol = presentationCurrencySymbol(currency);
  if (localized.startsWith("<")) {
    return prefixSymbols.has(symbol)
      ? `<${symbol}${localized.slice(1)}`
      : `${symbol} ${localized}`;
  }
  return prefixSymbols.has(symbol) ? `${symbol}${localized}` : `${symbol} ${localized}`;
}

function localizeDecimalComma(amount: string): string {
  if (amount.startsWith("<")) {
    return amount.replace(".", ",");
  }
  const [whole = "0", fraction] = amount.split(".");
  return fraction === undefined
    ? whole.replace(/,/g, ".")
    : `${whole.replace(/,/g, ".")},${fraction}`;
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
