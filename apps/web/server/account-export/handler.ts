import "server-only";

import { isAccountExportAuthBoundaryCode } from "@/shared/account/contracts/data-export";
import { readJson } from "@/shared/http/read-json";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { privateError, privateJson } from "@/server/http/private-response";
import { emitServerEvent } from "@/server/observability/log";
import { AccountExportError } from "./errors";
import { readAccountExport } from "./read";

export function createAccountExportHandler(dependencies: { authorize: SessionAuthorizer; read?: typeof readAccountExport }) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const session = await authorizeSession(request, dependencies.authorize);
      if (session instanceof Response) {
        const body = await readJson(session.clone()).catch(() => null);
        const reported = typeof body === "object" && body !== null && "error" in body
          && typeof body.error === "object" && body.error !== null && "code" in body.error ? body.error.code : null;
        const code = isAccountExportAuthBoundaryCode(reported) ? reported : session.status === 503 ? "AUTH_UNAVAILABLE" : "UNAUTHENTICATED";
        if (code === "ACCOUNT_DELETED" && session.headers.get("cache-control") === "private, no-store, max-age=0") return session;
        return privateError(code, code === "AUTH_UNAVAILABLE" ? "Authentication is temporarily unavailable." : "Authentication is required.", session.status);
      }
      if (request.signal.aborted) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
      const result = await (dependencies.read ?? readAccountExport)(session, request.signal);
      if (request.signal.aborted) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
      return privateJson(result);
    } catch (error) {
      const code = error instanceof AccountExportError ? error.code : "ACCOUNT_EXPORT_UNAVAILABLE";
      emitServerEvent("action-read", { route: "/api/account/export", code, outcome: code === "ACCOUNT_EXPORT_UNAVAILABLE" ? "unavailable" : "rejected" });
      if (error instanceof AccountExportError && error.code === "ACCOUNT_EXPORT_LINKAGE") return privateError(error.code, "Your account records could not be linked safely.", 409);
      if (error instanceof AccountExportError && error.code === "ACCOUNT_EXPORT_TOO_LARGE") return privateError(error.code, "Your account export exceeds the download limit.", 413);
      return privateError("ACCOUNT_EXPORT_UNAVAILABLE", "Your account export is temporarily unavailable.", 503);
    }
  };
}
