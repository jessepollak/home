import "server-only";

import { normalizeCountryCode, type CountryCode } from "@/config/regions";

export const requestCountryHeader = "x-vercel-ip-country";

const unassignedCountryCodes = new Set(["XX", "ZZ"]);

export function readRequestIsoCountry(headers: Pick<Headers, "get">): string | null {
  const value = headers.get(requestCountryHeader)?.trim().toUpperCase();
  if (!value || !/^[A-Z]{2}$/.test(value) || unassignedCountryCodes.has(value)) return null;
  return value;
}

export function readRequestCountry(headers: Pick<Headers, "get">): CountryCode | null {
  return normalizeCountryCode(headers.get(requestCountryHeader));
}
