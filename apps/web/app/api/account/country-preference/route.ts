import { authorizeSession } from "@/server/auth/authorize";
import { createCountryPreferenceHandler, createCountryPreferenceReadHandler } from "@/server/preferences/handler";


export const GET = createCountryPreferenceReadHandler({ authorize: authorizeSession });
export const PUT = createCountryPreferenceHandler({ authorize: authorizeSession });
