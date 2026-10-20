import * as z from "zod/mini";
import { AUTH_BOUNDARY_ERROR_CODES, type AuthBoundaryErrorCode } from "./auth-boundary";
import { normalizeCountryCode, type CountryCode } from "@/config/regions";
import type { AccountProvider } from "@/shared/account/session-types";

export const COUNTRY_PREFERENCE_VERSION = 1 as const;

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
};

const countryCodeSchema = z.pipe(
  z.string(),
  z.pipe(z.transform((value: string) => normalizeCountryCode(value)), z.custom<CountryCode>((value) => value !== null)),
);
const countryPreferenceRequestSchema = z.pipe(z.object({
  version: z.literal(COUNTRY_PREFERENCE_VERSION),
  regionId: countryCodeSchema,
  adopt: z.optional(z.boolean()),
}), z.transform((value) => ({
  version: value.version,
  regionId: value.regionId,
  ...(value.adopt === undefined ? {} : { adopt: value.adopt }),
})));
const countryPreferenceResponseSchema = z.object({
  version: z.literal(COUNTRY_PREFERENCE_VERSION),
  regionId: countryCodeSchema,
});
const countryPreferenceReadResponseSchema = z.object({
  version: z.literal(COUNTRY_PREFERENCE_VERSION),
  regionId: z.nullable(countryCodeSchema),
});

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
