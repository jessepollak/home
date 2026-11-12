import "server-only";

import { COUNTRY_DEFAULT_CURRENCY, isOfferedDisplayCurrency } from "@/shared/account/display-currency";
import { deletionAuthErrorResponse } from "@/server/account-deletion/errors";

import { COUNTRY_PREFERENCE_VERSION, parseCountryPreferenceRequest, type CountryPreferenceReadResponse, type CountryPreferenceResponse } from "@/shared/account/contracts/country-preference";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { privateError, privateJson } from "@/server/http/private-response";
import { isRegionOffered } from "@/server/operator-settings/regions";
import { readCountryPreference, writeCountryPreference } from "./country";
import { readJsonBody } from "@/server/http/request";

export function createCountryPreferenceReadHandler(dependencies: {
  authorize: SessionAuthorizer;
  read?: typeof readCountryPreference;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    try {
      const preference = await (dependencies.read ?? readCountryPreference)(session);
      return privateJson({ version: COUNTRY_PREFERENCE_VERSION, regionId: preference?.regionId ?? null, displayCurrency: preference?.displayCurrency ?? null } satisfies CountryPreferenceReadResponse, 200);
    } catch (error) {
      const deletionError = deletionAuthErrorResponse(error);
      if (deletionError) return deletionError;
      return privateError("COUNTRY_PREFERENCE_UNAVAILABLE", "Country preference could not be read.", 503);
    }
  };
}

export function createCountryPreferenceHandler(dependencies: {
  authorize: SessionAuthorizer;
  write?: typeof writeCountryPreference;
  regionOffered?: (region: string) => Promise<boolean>;
}) {
  return async function PUT(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const result = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const body = result.kind === "ok" ? result.value : null;
    if (typeof body === "object" && body !== null && "displayCurrency" in body &&
      body.displayCurrency !== COUNTRY_DEFAULT_CURRENCY && !isOfferedDisplayCurrency(body.displayCurrency)) {
      return privateError("COUNTRY_PREFERENCE_INVALID", "Choose a supported currency.", 400);
    }
    const input = parseCountryPreferenceRequest(body);
    if (!input) return privateError("COUNTRY_PREFERENCE_INVALID", "Choose a supported country.", 400);
    try {
      if (input.regionId !== undefined && !await (dependencies.regionOffered ?? isRegionOffered)(input.regionId)) {
        return privateError("COUNTRY_PREFERENCE_INVALID", "Choose a supported country.", 400);
      }
      const preference = await (dependencies.write ?? writeCountryPreference)(session, input, { onlyIfUnset: input.adopt === true });
      return privateJson({ version: COUNTRY_PREFERENCE_VERSION, ...preference } satisfies CountryPreferenceResponse, 200);
    } catch (error) {
      const deletionError = deletionAuthErrorResponse(error);
      if (deletionError) return deletionError;
      return privateError("COUNTRY_PREFERENCE_UNAVAILABLE", "Country preference could not be saved.", 503);
    }
  };
}
