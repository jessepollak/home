import { normalizeCountryCode, type CountryCode } from "@/config/regions";
import type { AccountProvider } from "@/shared/account/session-types";

export const COUNTRY_PREFERENCE_VERSION = 1 as const;

export type CountryPreferenceSeed = {
  accountProvider: AccountProvider;
  subject: string;
  regionId: CountryCode | null;
};

export type CountryPreferenceRequest = {
  version: typeof COUNTRY_PREFERENCE_VERSION;
  regionId: CountryCode;
  adopt?: boolean;
};

export type CountryPreferenceResponse = {
  version: typeof COUNTRY_PREFERENCE_VERSION;
  regionId: CountryCode;
};

export type CountryPreferenceReadResponse = {
  version: typeof COUNTRY_PREFERENCE_VERSION;
  regionId: CountryCode | null;
};

export function parseCountryPreferenceRequest(value: unknown): CountryPreferenceRequest | null {
  if (!isRecord(value) || value.version !== COUNTRY_PREFERENCE_VERSION || typeof value.regionId !== "string" ||
    (value.adopt !== undefined && typeof value.adopt !== "boolean")) return null;
  const regionId = normalizeCountryCode(value.regionId);
  return regionId ? { version: COUNTRY_PREFERENCE_VERSION, regionId, ...(value.adopt === undefined ? {} : { adopt: value.adopt }) } : null;
}

export function parseCountryPreferenceResponse(value: unknown): CountryPreferenceResponse | null {
  if (!isRecord(value) || value.version !== COUNTRY_PREFERENCE_VERSION || typeof value.regionId !== "string") return null;
  const regionId = normalizeCountryCode(value.regionId);
  return regionId ? { version: COUNTRY_PREFERENCE_VERSION, regionId } : null;
}

export function parseCountryPreferenceReadResponse(value: unknown): CountryPreferenceReadResponse | null {
  if (!isRecord(value) || value.version !== COUNTRY_PREFERENCE_VERSION) return null;
  if (value.regionId === null) return { version: COUNTRY_PREFERENCE_VERSION, regionId: null };
  return parseCountryPreferenceResponse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
