import "server-only";

import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

export function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}

export function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(privateResponseHeaders).forEach(([name, value]) =>
    headers.set(name, value),
  );
  return new Response(response.body, { status: response.status, headers });
}
