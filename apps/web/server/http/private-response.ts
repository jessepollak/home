import "server-only";

import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

export function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}
