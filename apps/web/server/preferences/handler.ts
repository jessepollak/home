import "server-only";

import { COUNTRY_PREFERENCE_VERSION, parseCountryPreferenceRequest, type CountryPreferenceReadResponse, type CountryPreferenceResponse } from "@/shared/account/contracts/country-preference";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { privateError, privateJson } from "@/server/http/private-response";
import { readCountryPreference, writeCountryPreference } from "./country";

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
    } catch {
      return privateError("COUNTRY_PREFERENCE_UNAVAILABLE", "Country preference could not be read.", 503);
    }
  };
}

export function createCountryPreferenceHandler(dependencies: {
  authorize: SessionAuthorizer;
  write?: typeof writeCountryPreference;
}) {
  return async function PUT(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const input = parseCountryPreferenceRequest(await request.json().catch(() => null));
    if (!input) return privateError("COUNTRY_PREFERENCE_INVALID", "Choose a supported country.", 400);
    try {
      const regionId = await (dependencies.write ?? writeCountryPreference)(session, input.regionId, { onlyIfUnset: input.adopt === true });
      return privateJson({ version: COUNTRY_PREFERENCE_VERSION, regionId } satisfies CountryPreferenceResponse, 200);
    } catch {
      return privateError("COUNTRY_PREFERENCE_UNAVAILABLE", "Country preference could not be saved.", 503);
    }
  };
}
