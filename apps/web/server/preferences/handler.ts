import "server-only";

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
      const regionId = await (dependencies.read ?? readCountryPreference)(session);
      return privateJson({ version: COUNTRY_PREFERENCE_VERSION, regionId } satisfies CountryPreferenceReadResponse, 200);
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
    const input = parseCountryPreferenceRequest(result.kind === "ok" ? result.value : null);
    if (!input) return privateError("COUNTRY_PREFERENCE_INVALID", "Choose a supported country.", 400);
    try {
      if (!await (dependencies.regionOffered ?? isRegionOffered)(input.regionId)) {
        return privateError("COUNTRY_PREFERENCE_INVALID", "Choose a supported country.", 400);
      }
      const regionId = await (dependencies.write ?? writeCountryPreference)(session, input.regionId, { onlyIfUnset: input.adopt === true });
      return privateJson({ version: COUNTRY_PREFERENCE_VERSION, regionId } satisfies CountryPreferenceResponse, 200);
    } catch (error) {
      const deletionError = deletionAuthErrorResponse(error);
      if (deletionError) return deletionError;
      return privateError("COUNTRY_PREFERENCE_UNAVAILABLE", "Country preference could not be saved.", 503);
    }
  };
}
