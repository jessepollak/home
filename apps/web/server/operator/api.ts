import "server-only";

import type { Named } from "@gdp-ts/core";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { OPERATOR_CONTRACT_VERSION } from "@/shared/operator/contract";
import { assertSessionLive } from "@/server/account-deletion/tombstone";
import { deletionAuthErrorResponse } from "@/server/account-deletion/errors";
import { authorizeSession, authUnavailableResponse } from "@/server/auth/authorize";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readCookie } from "@/server/auth/signed-cookie";
import { readHomeSessionSecret } from "@/server/config/env";
import { privateJson } from "@/server/http/private-response";
import { withOperatorAccess, type OperatorAccess, type OperatorAddress } from "@/server/proofs/operator-access";
import { decideOperatorAccess } from "./authorize";
import { readOperatorConfig, type OperatorConfig } from "./config";
import { issueOperatorGrant, readOperatorGrant, requestCookieStore } from "./email-grant";

type GrantReader = (request: Request) => Promise<VerifiedAccountSession | Response | null>;

export function operatorGrantReader(
  now: () => Date = () => new Date(),
  live: typeof assertSessionLive = assertSessionLive,
): GrantReader {
  return async (request) => {
    const session = readOperatorGrant(requestCookieStore(request), readHomeSessionSecret(), now());
    if (!session) return null;
    try {
      await live(session, now());
      return session;
    } catch (error) {
      return deletionAuthErrorResponse(error) ?? authUnavailableResponse();
    }
  };
}

const readRequestOperatorGrant = operatorGrantReader();

export async function authorizeOperatorRequest<R>(
  request: Request,
  run: <N>(operator: Named<N, OperatorAddress>, proof: OperatorAccess<N>) => R,
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
  grant: GrantReader = readRequestOperatorGrant,
): Promise<Response | R> {
  const nativeCookie = readCookie(request, HOME_SESSION_COOKIE);
  const granted = !nativeCookie.present && !request.headers.has("Authorization") ? await grant(request) : null;
  const headers = new Headers(request.headers);
  if (nativeCookie.present && !headers.has(ACCOUNT_PROVIDER_HEADER)) {
    headers.set(ACCOUNT_PROVIDER_HEADER, "base-account");
  }
  const verified = granted ?? await authorize(new Request(request.url, { method: request.method, headers }));
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
  grant: GrantReader = readRequestOperatorGrant,
) {
  return async function handle(request: Request): Promise<Response> {
    return authorizeOperatorRequest(request, (operator) => {
      if (!found) return privateJson({ error: { code: "NOT_FOUND" } }, 404);
      return privateJson({ version: OPERATOR_CONTRACT_VERSION, operator: { address: operator.value } }, 200);
    }, authorize, config, grant);
  };
}

export function createOperatorGrantHandler(
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
  secret: () => string | undefined = readHomeSessionSecret,
  now: () => Date = () => new Date(),
) {
  return async function POST(request: Request): Promise<Response> {
    const unauthenticated = () => privateJson({ error: { code: "UNAUTHENTICATED" } }, 401);
    if (readCookie(request, HOME_SESSION_COOKIE).present || !request.headers.has("Authorization")) return unauthenticated();
    const verified = await authorize(request);
    if (verified instanceof Response) return verified.status === 503 ? verified : unauthenticated();
    if (verified.accountProvider !== "cdp-embedded") return unauthenticated();
    const decision = decideOperatorAccess(verified, config());
    if (decision.kind !== "operator") return privateJson({ error: { code: "OPERATOR_FORBIDDEN" } }, 403);
    const grant = issueOperatorGrant(secret(), verified, request, now());
    if (!grant) return unauthenticated();
    const response = privateJson({ version: OPERATOR_CONTRACT_VERSION, operator: { address: decision.address } }, 200);
    response.headers.append("Set-Cookie", grant);
    return response;
  };
}
