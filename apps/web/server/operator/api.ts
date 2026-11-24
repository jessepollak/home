import "server-only";

import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { OPERATOR_CONTRACT_VERSION } from "@/shared/operator/contract";
import { assertSessionLive } from "@/server/account-deletion/tombstone";
import { authorizeSession } from "@/server/auth/authorize";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readCookie } from "@/server/auth/signed-cookie";
import { readHomeSessionSecret } from "@/server/config/env";
import { privateJson } from "@/server/http/private-response";
import { decideOperatorAccess } from "./authorize";
import { readOperatorConfig, type OperatorConfig } from "./config";
import { issueOperatorGrant, readOperatorGrant, requestCookieStore } from "./email-grant";

type GrantReader = (request: Request) => Promise<VerifiedAccountSession | Response | null>;

export function operatorGrantReader(now: () => Date = () => new Date()): GrantReader {
  return async (request) => {
    const session = readOperatorGrant(requestCookieStore(request), readHomeSessionSecret(), now());
    if (!session) return null;
    try {
      await assertSessionLive(session, now());
      return session;
    } catch {
      return privateJson({ error: { code: "UNAUTHENTICATED" } }, 401);
    }
  };
}

const readRequestOperatorGrant = operatorGrantReader();

export async function authorizeOperatorRequest(
  request: Request,
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response> = authorizeSession,
  config: () => OperatorConfig = readOperatorConfig,
  grant: GrantReader = readRequestOperatorGrant,
): Promise<{ address: `0x${string}` } | Response> {
  const nativeCookie = readCookie(request, HOME_SESSION_COOKIE);
  const granted = !nativeCookie.present && !request.headers.has("Authorization") ? await grant(request) : null;
  if (granted instanceof Response) return granted;
  const headers = new Headers(request.headers);
  if (nativeCookie.present && !headers.has(ACCOUNT_PROVIDER_HEADER)) {
    headers.set(ACCOUNT_PROVIDER_HEADER, "base-account");
  }
  const verified = granted ?? await authorize(new Request(request.url, { method: request.method, headers }));
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
  grant: GrantReader = readRequestOperatorGrant,
) {
  return async function handle(request: Request): Promise<Response> {
    const decision = await authorizeOperatorRequest(request, authorize, config, grant);
    if (decision instanceof Response) return decision;
    if (!found) return privateJson({ error: { code: "NOT_FOUND" } }, 404);
    return privateJson({ version: OPERATOR_CONTRACT_VERSION, operator: decision }, 200);
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
