import * as z from "zod/mini";
import { normalizeCountryCode, type CountryCode } from "@/config/regions";
import type { AccountProvider } from "@/shared/account/session-types";

export const COUNTRY_PREFERENCE_VERSION = 1 as const;

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
