import * as z from "zod/mini";
import { AUTH_BOUNDARY_ERROR_CODES, type AuthBoundaryErrorCode } from "./auth-boundary";
import { normalizeCountryCode, type CountryCode } from "@/config/regions";
import { COUNTRY_DEFAULT_CURRENCY, isCurrencyShape, isOfferedDisplayCurrency, type DisplayCurrencyChoice } from "@/shared/account/display-currency";
import type { AccountProvider } from "@/shared/account/session-types";

export const COUNTRY_PREFERENCE_VERSION = 2 as const;

export type CountryPreferenceErrorCode = AuthBoundaryErrorCode | "COUNTRY_PREFERENCE_INVALID" | "COUNTRY_PREFERENCE_UNAVAILABLE";
export const COUNTRY_PREFERENCE_ERROR_CODES: readonly CountryPreferenceErrorCode[] = [
  ...AUTH_BOUNDARY_ERROR_CODES, "COUNTRY_PREFERENCE_INVALID", "COUNTRY_PREFERENCE_UNAVAILABLE",
];
export type CountryPreferenceErrorResponse = { error: { code: CountryPreferenceErrorCode; message: string } };

export function isCountryPreferenceErrorCode(value: unknown): value is CountryPreferenceErrorCode {
  return typeof value === "string" && COUNTRY_PREFERENCE_ERROR_CODES.some((code) => code === value);
}

/** @public parses country-preference endpoint errors for clients */
export function parseCountryPreferenceErrorResponse(value: unknown): CountryPreferenceErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error) || !isCountryPreferenceErrorCode(value.error.code) ||
    typeof value.error.message !== "string" || value.error.message.length === 0) return null;
  return { error: { code: value.error.code, message: value.error.message } };
}

export type CountryPreferenceSeed = {
  accountProvider: AccountProvider;
  subject: string;
  regionId: CountryCode | null;
  displayCurrency: string | null;
};

const countryCodeSchema = z.pipe(
  z.string(),
  z.pipe(z.transform((value: string) => normalizeCountryCode(value)), z.custom<CountryCode>((value) => value !== null)),
);
const displayCurrencyChoiceSchema = z.custom<DisplayCurrencyChoice>((value) =>
  value === COUNTRY_DEFAULT_CURRENCY || isOfferedDisplayCurrency(value));
const storedDisplayCurrencySchema = z.nullable(z.custom<string>((value) =>
  value === COUNTRY_DEFAULT_CURRENCY || isCurrencyShape(value)));
const countryPreferenceRequestSchema = z.pipe(z.object({
  version: z.literal(COUNTRY_PREFERENCE_VERSION),
  regionId: z.optional(countryCodeSchema),
  displayCurrency: z.optional(displayCurrencyChoiceSchema),
  adopt: z.optional(z.boolean()),
}).check(z.refine((value) => value.regionId !== undefined || value.displayCurrency !== undefined)), z.transform((value) => ({
  version: value.version,
  ...(value.regionId === undefined ? {} : { regionId: value.regionId }),
  ...(value.displayCurrency === undefined ? {} : { displayCurrency: value.displayCurrency }),
  ...(value.adopt === undefined ? {} : { adopt: value.adopt }),
})));
const countryPreferenceResponseSchema = z.object({
  version: z.literal(COUNTRY_PREFERENCE_VERSION),
  regionId: z.nullable(countryCodeSchema),
  displayCurrency: storedDisplayCurrencySchema,
});
const countryPreferenceReadResponseSchema = countryPreferenceResponseSchema;

export type CountryPreferenceRequest = z.output<typeof countryPreferenceRequestSchema>;
export type CountryPreferenceResponse = z.output<typeof countryPreferenceResponseSchema>;
export type CountryPreferenceReadResponse = z.output<typeof countryPreferenceReadResponseSchema>;

export function parseCountryPreferenceRequest(value: unknown): CountryPreferenceRequest | null {
  const result = countryPreferenceRequestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCountryPreferenceResponse(value: unknown): CountryPreferenceResponse | null {
  const result = countryPreferenceResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCountryPreferenceReadResponse(value: unknown): CountryPreferenceReadResponse | null {
  const result = countryPreferenceReadResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
