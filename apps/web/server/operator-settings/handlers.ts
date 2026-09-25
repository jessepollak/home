import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { getSqlExecutor } from "@/server/db/sql";
import { privateJson } from "@/server/http/private-response";
import { authorizeOperatorRequest } from "@/server/operator/api";
import { readOperatorConfig, type OperatorConfig } from "@/server/operator/config";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parsePutSettingsRequest, validCursor, type OperatorSettingsErrorCode } from "@/shared/operator-settings/contract";
import { AdminAuditLog } from "./audit";
import { OperatorSettingsConflictError, OperatorSettingsStore, OperatorSettingsValidationError } from "./store";

type Dependencies = {
  authorize?: (request: Request) => Promise<VerifiedAccountSession | Response>;
  config?: () => OperatorConfig;
  store?: () => OperatorSettingsStore;
  audit?: () => AdminAuditLog;
};

function error(code: OperatorSettingsErrorCode, status: number): Response {
  return privateJson({ error: { code } }, status);
}

function providers(deps: Dependencies) {
  return {
    store: deps.store ?? (() => new OperatorSettingsStore(getSqlExecutor())),
    audit: deps.audit ?? (() => new AdminAuditLog(getSqlExecutor())),
  };
}

async function authorized(request: Request, deps: Dependencies) {
  return authorizeOperatorRequest(request, deps.authorize ?? authorizeSession, deps.config ?? readOperatorConfig);
}

async function available(run: () => Promise<Response>): Promise<Response> {
  try { return await run(); }
  catch (cause) {
    if (cause instanceof OperatorSettingsValidationError) return error("INVALID_REQUEST", 400);
    return error("SETTINGS_UNAVAILABLE", 503);
  }
}

export function createSettingsListHandler(deps: Dependencies = {}) {
  const { store } = providers(deps);
  return async (request: Request): Promise<Response> => {
    const decision = await authorized(request, deps);
    if (decision instanceof Response) return decision;
    return available(async () => privateJson({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, domains: await store().readAll() }, 200));
  };
}

export function createSettingsDomainHandlers(deps: Dependencies = {}) {
  const { store } = providers(deps);
  const GET = async (request: Request, context: { params: Promise<{ domain: string }> }): Promise<Response> => {
    const decision = await authorized(request, deps);
    if (decision instanceof Response) return decision;
    const { domain } = await context.params;
    return available(async () => {
      const settingsStore = store();
      if (!settingsStore.hasDomain(domain)) return error("NOT_FOUND", 404);
      return privateJson({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, ...await settingsStore.read(domain) }, 200);
    });
  };
  const PUT = async (request: Request, context: { params: Promise<{ domain: string }> }): Promise<Response> => {
    const decision = await authorized(request, deps);
    if (decision instanceof Response) return decision;
    const { domain } = await context.params;
    return available(async () => {
      const settingsStore = store();
      if (!settingsStore.hasDomain(domain)) return error("NOT_FOUND", 404);
      const expected = requestOrigin(request);
      const origin = request.headers.get("origin");
      const site = request.headers.get("sec-fetch-site");
      if (!expected || !origin || origin !== expected.origin || (site !== null && site !== "same-origin")) return error("CROSS_ORIGIN", 403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return error("INVALID_REQUEST", 400);
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16_384)) return error("INVALID_REQUEST", 400);
      let text = "";
      try {
        const reader = request.body?.getReader();
        if (!reader) return error("INVALID_REQUEST", 400);
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16_384) { await reader.cancel(); return error("INVALID_REQUEST", 400); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch { return error("INVALID_REQUEST", 400); }
      let body: unknown;
      try { body = JSON.parse(text); } catch { return error("INVALID_REQUEST", 400); }
      const parsed = parsePutSettingsRequest(body);
      if (!parsed) return error("INVALID_REQUEST", 400);
      try {
        const written = await settingsStore.write({ domain, value: parsed.value, expectedRevision: parsed.expectedRevision, actor: decision.address });
        return privateJson({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, ...written }, 200);
      } catch (cause) {
        if (cause instanceof OperatorSettingsConflictError) {
          const current = await settingsStore.read(domain);
          return privateJson({ error: { code: "SETTINGS_CONFLICT" }, current: { version: OPERATOR_SETTINGS_CONTRACT_VERSION, ...current } }, 409);
        }
        throw cause;
      }
    });
  };
  return { GET, PUT };
}

export function createAuditListHandler(deps: Dependencies = {}) {
  const { audit } = providers(deps);
  return async (request: Request): Promise<Response> => {
    const decision = await authorized(request, deps);
    if (decision instanceof Response) return decision;
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "limit" && key !== "before") || params.getAll("limit").length > 1 || params.getAll("before").length > 1) return error("INVALID_REQUEST", 400);
    const rawLimit = params.get("limit");
    const rawBefore = params.get("before");
    if ((rawLimit !== null && (!/^(?:[1-9]|[1-9]\d|100)$/.test(rawLimit))) || (rawBefore !== null && !validCursor(rawBefore))) return error("INVALID_REQUEST", 400);
    return available(async () => privateJson({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, ...await audit().list({ limit: rawLimit === null ? undefined : Number(rawLimit), before: rawBefore ?? undefined }) }, 200));
  };
}
