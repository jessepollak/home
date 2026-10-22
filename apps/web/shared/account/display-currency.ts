import { presentationRegions, type FiatCurrencyCode, type RegionId } from "@/config/regions";
import { activityValuationCurrencies } from "@/shared/activity/valuation";

export const COUNTRY_DEFAULT_CURRENCY = "country-default" as const;
export const offeredDisplayCurrencies: readonly FiatCurrencyCode[] = activityValuationCurrencies;
export type DisplayCurrencyChoice = typeof COUNTRY_DEFAULT_CURRENCY | FiatCurrencyCode;

export type ResolvedDisplayCurrency = {
  currency: FiatCurrencyCode | null;
  source: "explicit" | "country-default";
  withdrawn: string | null;
};

export function isOfferedDisplayCurrency(value: unknown): value is FiatCurrencyCode {
  return typeof value === "string" && offeredDisplayCurrencies.some((code) => code === value);
}

export function parseDisplayCurrencyChoice(value: unknown): DisplayCurrencyChoice | null {
  if (value === COUNTRY_DEFAULT_CURRENCY) return COUNTRY_DEFAULT_CURRENCY;
  return isOfferedDisplayCurrency(value) ? value : null;
}
export function isCurrencyShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function countryDefaultCurrency(regionId: RegionId): FiatCurrencyCode | null {
  return presentationRegions[regionId].currency.code;
}

export function resolveDisplayCurrency(
  regionId: RegionId,
  stored: string | null | undefined,
): ResolvedDisplayCurrency {
  const fallback = countryDefaultCurrency(regionId);
  if (stored === undefined || stored === null || stored === COUNTRY_DEFAULT_CURRENCY) {
    return { currency: fallback, source: "country-default", withdrawn: null };
  }
  if (isOfferedDisplayCurrency(stored)) return { currency: stored, source: "explicit", withdrawn: null };
  return { currency: fallback, source: "country-default", withdrawn: stored };
}
export type PresentationScope = { region: RegionId; currency: FiatCurrencyCode | null };

export function presentationScopeKey(scope: PresentationScope): string {
  return `${scope.region}|${scope.currency ?? "none"}`;
}
