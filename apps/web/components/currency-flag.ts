import { presentationRegions } from "@/config/regions";

const EURO_FLAG = "eu";

/**
 * Presentation / cash denomination → circle-flag file stem.
 * EUR uses the EU flag (not a member-state flag). Unknown or crypto
 * tickers return null — callers must fail open to a symbol fallback.
 */
export function presentationCurrencyFlag(
  currency: string | null | undefined,
): string | null {
  const code = currency?.trim().toUpperCase();
  if (!code) return null;
  if (code === "EUR") return EURO_FLAG;
  for (const region of Object.values(presentationRegions)) {
    if (region.currency.code === code && region.countryCode) {
      return region.countryCode.toLowerCase();
    }
  }
  return null;
}

export function currencyFlagSrc(flag: string): string {
  return `/currency-flags/${flag}.svg`;
}
