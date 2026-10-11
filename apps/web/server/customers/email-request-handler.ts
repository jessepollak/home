import "server-only";

import { deletionAuthErrorResponse } from "@/server/account-deletion/errors";

import { EMAIL_REQUEST_VERSION, parseEmailRequestWrite, type EmailRequestClaimResponse, type EmailRequestErrorCode, type EmailRequestReadResponse, type EmailRequestWriteResponse } from "@/shared/account/contracts/email-request";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { privateError, privateJson } from "@/server/http/private-response";
import { EmailRequestIdentityMismatchError, claimEmailRequest, readEmailRequest, writeEmailRequest } from "./email-request";
import { readJsonBody } from "@/server/http/request";

const EMAIL_REQUEST_ERRORS = {
  unsupported: "EMAIL_REQUEST_UNSUPPORTED",
  unavailable: "EMAIL_REQUEST_UNAVAILABLE",
  invalid: "EMAIL_REQUEST_INVALID",
} satisfies Record<string, EmailRequestErrorCode>;

export function createEmailRequestReadHandler(dependencies: {
  authorize: SessionAuthorizer;
  read?: typeof readEmailRequest;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (session.accountProvider !== "base-account") return privateError(EMAIL_REQUEST_ERRORS.unsupported, "Email sharing is unavailable for this account.", 403);
    try {
      const result = await (dependencies.read ?? readEmailRequest)(session);
      if (!result) return privateError(EMAIL_REQUEST_ERRORS.unavailable, "Email sharing is temporarily unavailable.", 503);
      return privateJson({ version: EMAIL_REQUEST_VERSION, asked: result.asked } satisfies EmailRequestReadResponse, 200);
    } catch (error) {
      const deletionError = deletionAuthErrorResponse(error);
      if (deletionError) return deletionError;
      return privateError(EMAIL_REQUEST_ERRORS.unavailable, "Email sharing is temporarily unavailable.", 503);
    }
  };
}

export function createEmailRequestWriteHandler(dependencies: {
  authorize: SessionAuthorizer;
  write?: typeof writeEmailRequest;
  claim?: typeof claimEmailRequest;
}) {
  return async function POST(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (session.accountProvider !== "base-account") return privateError(EMAIL_REQUEST_ERRORS.unsupported, "Email sharing is unavailable for this account.", 403);
    if (!isSameOriginPost(request)) return privateError(EMAIL_REQUEST_ERRORS.unsupported, "Email sharing is unavailable for this request.", 403);
    const result = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const input = parseEmailRequestWrite(result.kind === "ok" ? result.value : null);
    if (!input) return privateError(EMAIL_REQUEST_ERRORS.invalid, "Email request is invalid.", 400);
    try {
      if (input.kind === "claim") {
        const result = await (dependencies.claim ?? claimEmailRequest)(session, input);
        return privateJson({ version: EMAIL_REQUEST_VERSION, claimed: result.claimed } satisfies EmailRequestClaimResponse, 200);
      }
      const result = await (dependencies.write ?? writeEmailRequest)(session, input);
      return privateJson({ version: EMAIL_REQUEST_VERSION, asked: result.asked } satisfies EmailRequestWriteResponse, 200);
    } catch (error) {
      const deletionError = deletionAuthErrorResponse(error);
      if (deletionError) return deletionError;
      if (error instanceof EmailRequestIdentityMismatchError) return privateError(EMAIL_REQUEST_ERRORS.invalid, "Email request is invalid.", 400);
      return privateError(EMAIL_REQUEST_ERRORS.unavailable, "Email sharing is temporarily unavailable.", 503);
    }
  };
}

function isSameOriginPost(request: Request): boolean {
  const expected = requestOrigin(request)?.origin;
  const rawOrigin = request.headers.get("origin");
  if (!expected || !rawOrigin || rawOrigin === "null") return false;
  try {
    const supplied = new URL(rawOrigin);
    if (supplied.origin !== rawOrigin || supplied.origin !== expected) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}
