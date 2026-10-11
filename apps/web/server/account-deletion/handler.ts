import "server-only";

import { parseAccountDeletionErrorResponse, type AccountDeletionErrorCode } from "@/shared/account/contracts/account-deletion";
import { authorizeRawSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { readBoundedRequestText } from "@/server/http/request";
import { privateError, privateJson } from "@/server/http/private-response";
import { emitServerEvent } from "@/server/observability/log";
import { AccountDeletionError } from "./errors";
import { readAccountDeletion } from "./store";

export function createAccountDeletionHandler(deps: { authorize: SessionAuthorizer; read?: typeof readAccountDeletion }) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const session = await authorizeRawSession(request, deps.authorize);
      if (session instanceof Response) return session;
      if (request.signal.aborted) throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
      if (request.method === "POST") {
        const body = await readBoundedRequestText(request, { maxBytes: 1024, fatal: true });
        if (body.kind !== "empty" && (body.kind !== "ok" || !emptyBody(body.text))) return privateError("INVALID_REQUEST", "Leave Home does not accept account details.", 400);
      }
      const receipt = await (deps.read ?? readAccountDeletion)(session, request.method === "POST", request.signal);
      if (request.signal.aborted) throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
      return privateJson(receipt);
    } catch (error) {
      const code = error instanceof AccountDeletionError ? error.code : "ACCOUNT_DELETION_UNAVAILABLE";
      emitServerEvent("action-read", { route: "/api/account/deletion", code, outcome: code === "ACCOUNT_DELETION_UNAVAILABLE" ? "unavailable" : "rejected" });
      if (code === "ACCOUNT_DELETION_LINKAGE") return deletionErrorResponse(code, "Your account records could not be linked safely.", 409);
      if (code === "ACCOUNT_DELETION_NOT_FOUND") return deletionErrorResponse(code, "No Leave Home request was found.", 404);
      return deletionErrorResponse("ACCOUNT_DELETION_UNAVAILABLE", "Leave Home is temporarily unavailable. Try again later.", 503);
    }
  };
}

function emptyBody(text: string): boolean {
  if (!text.trim()) return true;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
  } catch { return false; }
}

function deletionErrorResponse(code: AccountDeletionErrorCode, message: string, status: number): Response {
  const body = parseAccountDeletionErrorResponse({ error: { code, message } });
  if (!body) throw new Error("Invalid account deletion error contract");
  return privateJson(body, status);
}
