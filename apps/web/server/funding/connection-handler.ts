import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { privateJson } from "@/server/http/private-response";
import { readJsonBody } from "@/server/http/request";
import { authorizeOperatorRequest } from "@/server/operator/api";
import { readOperatorConfig, type OperatorConfig } from "@/server/operator/config";
import { fundingProviders } from "@/server/funding/providers";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { FundingProvider } from "@/shared/funding/provider-contract";
import type { OperatorSettingsErrorCode } from "@/shared/operator-settings/contract";
import { FUNDING_CONNECTIONS_VERSION, parseFundingConnectionRequest, parseFundingConnectionResponse } from "@/shared/operator-settings/contract-funding-connections";
import { checkFundingConnection } from "./connection-check";

type Dependencies = {
  authorize?: (request: Request) => Promise<VerifiedAccountSession | Response>;
  config?: () => OperatorConfig;
  providers?: readonly FundingProvider[];
  check?: typeof checkFundingConnection;
};

function error(code: OperatorSettingsErrorCode, status: number): Response {
  return privateJson({ error: { code } }, status);
}

export function createFundingConnectionHandler(deps: Dependencies = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      const decision = await authorizeOperatorRequest(request, deps.authorize ?? authorizeSession, deps.config ?? readOperatorConfig);
      if (decision instanceof Response) return decision;
      const expected = requestOrigin(request);
      const origin = request.headers.get("origin");
      const site = request.headers.get("sec-fetch-site");
      if (!expected || !origin || origin !== expected.origin || (site !== null && site !== "same-origin")) return error("CROSS_ORIGIN", 403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return error("INVALID_REQUEST", 400);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      const parsed = body.kind === "ok" ? parseFundingConnectionRequest(body.value) : null;
      if (!parsed) return error("INVALID_REQUEST", 400);
      const providers = deps.providers ?? fundingProviders;
      if (!providers.some((provider) => provider.manifest.id === parsed.providerId)) return error("NOT_FOUND", 404);
      const result = await (deps.check ?? checkFundingConnection)({ providerId: parsed.providerId, providers });
      const response = parseFundingConnectionResponse({ version: FUNDING_CONNECTIONS_VERSION, ...result });
      return response ? privateJson(response, 200) : error("SETTINGS_UNAVAILABLE", 503);
    } catch {
      return error("SETTINGS_UNAVAILABLE", 503);
    }
  };
}
