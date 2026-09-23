import "server-only";

import { normalizeCountryCode, type CountryCode } from "@/config/regions";

export const requestCountryHeader = "x-vercel-ip-country";

export function readRequestCountry(headers: Pick<Headers, "get">): CountryCode | null {
  return normalizeCountryCode(headers.get(requestCountryHeader));
}
