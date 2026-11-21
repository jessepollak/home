import "server-only";

import type { Named } from "@gdp-ts/core";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { OPERATOR_CONTRACT_VERSION } from "@/shared/operator/contract";
import { authorizeSession } from "@/server/auth/authorize";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readCookie } from "@/server/auth/signed-cookie";
import { privateJson } from "@/server/http/private-response";
import { withOperatorAccess, type OperatorAccess, type OperatorAddress } from "@/server/proofs/operator-access";
import { readOperatorConfig, type OperatorConfig } from "./config";

export async function authorizeOperatorRequest<R>(
  request: Request,
  run: <N>(operator: Named<N, OperatorAddress>, proof: OperatorAccess<N>) => R,
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
): Promise<Response | R> {
  const nativeCookie = readCookie(request, HOME_SESSION_COOKIE);
  const headers = new Headers(request.headers);
  if (nativeCookie.present && !headers.has(ACCOUNT_PROVIDER_HEADER)) {
    headers.set(ACCOUNT_PROVIDER_HEADER, "base-account");
  }
  const verified = await authorize(new Request(request.url, { method: request.method, headers }));
  if (verified instanceof Response) {
    if (verified.status === 503) return verified;
    return privateJson({ error: { code: "UNAUTHENTICATED" } }, 401);
  }
  const decision = withOperatorAccess(verified, config(), run);
  if (decision.kind === "unauthenticated") {
    return privateJson({ error: { code: "UNAUTHENTICATED" } }, 401);
  }
  if (decision.kind === "forbidden") {
    return privateJson({ error: { code: "OPERATOR_FORBIDDEN" } }, 403);
  }
  return decision.value;
}

export function createOperatorApiHandler(
  found: boolean,
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
) {
  return async function handle(request: Request): Promise<Response> {
    return authorizeOperatorRequest(request, (operator) => {
      if (!found) return privateJson({ error: { code: "NOT_FOUND" } }, 404);
      return privateJson({ version: OPERATOR_CONTRACT_VERSION, operator: { address: operator.value } }, 200);
    }, authorize, config);
  };
}
