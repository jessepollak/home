import "server-only";

import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { OPERATOR_CONTRACT_VERSION } from "@/shared/operator/contract";
import { authorizeSession } from "@/server/auth/authorize";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readCookie } from "@/server/auth/signed-cookie";
import { privateJson } from "@/server/http/private-response";
import { decideOperatorAccess } from "./authorize";
import { readOperatorConfig, type OperatorConfig } from "./config";

export async function authorizeOperatorRequest(
  request: Request,
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
): Promise<{ address: `0x${string}` } | Response> {
  const nativeCookie = readCookie(request, HOME_SESSION_COOKIE);
  const headers = new Headers(request.headers);
  if (nativeCookie.present && !headers.has(ACCOUNT_PROVIDER_HEADER)) {
    headers.set(ACCOUNT_PROVIDER_HEADER, "base-account");
  }
  const verified = await authorize(new Request(request, { headers }));
  if (verified instanceof Response) {
    if (verified.status === 503) return verified;
    return privateJson({ error: { code: "UNAUTHENTICATED" } }, 401);
  }
  const decision = decideOperatorAccess(verified, config());
  if (decision.kind !== "operator") {
    return privateJson({ error: { code: "OPERATOR_FORBIDDEN" } }, 403);
  }
  return { address: decision.address };
}

export function createOperatorApiHandler(
  found: boolean,
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
) {
  return async function handle(request: Request): Promise<Response> {
    const decision = await authorizeOperatorRequest(request, authorize, config);
    if (decision instanceof Response) return decision;
    if (!found) return privateJson({ error: { code: "NOT_FOUND" } }, 404);
    return privateJson({ version: OPERATOR_CONTRACT_VERSION, operator: decision }, 200);
  };
}
