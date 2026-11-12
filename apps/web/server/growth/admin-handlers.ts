import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { privateJson, withPrivateHeaders } from "@/server/http/private-response";
import { readJsonBody } from "@/server/http/request";
import { emitServerEvent } from "@/server/observability/log";
import { authorizeOperatorRequest } from "@/server/operator/api";
import { readOperatorConfig, type OperatorConfig } from "@/server/operator/config";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { GROWTH_ADMIN_CONTRACT_VERSION, parseRewardDecisionRequest, type GrowthAdminErrorCode } from "@/shared/growth/admin-contract";
import { approveReward, rejectReward } from "./queue";

type Dependencies = {
  authorize?: (request: Request) => Promise<VerifiedAccountSession | Response>;
  config?: () => OperatorConfig;
  sql?: () => SqlExecutor;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decisionErrors = {
  "not-found": ["NOT_FOUND", 404],
  "not-qualified": ["NOT_QUALIFIED", 409],
  "no-longer-qualifies": ["NO_LONGER_QUALIFIES", 409],
  "history-pending": ["HISTORY_PENDING", 409],
  "cap-reached": ["CAP_REACHED", 409],
  "budget-exhausted": ["BUDGET_EXHAUSTED", 409],
  "settings-missing": ["SETTINGS_MISSING", 409],
  "invalid-reason": ["INVALID_REQUEST", 400],
  "invalid-actor": ["INVALID_REQUEST", 400],
} as const satisfies Record<string, readonly [GrowthAdminErrorCode, number]>;

function error(code: GrowthAdminErrorCode, status: number): Response {
  return privateJson({ error: { code } }, status);
}

export function createRewardDecisionHandler(deps: Dependencies = {}) {
  return async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    try {
      const operator = await authorizeOperatorRequest(request, deps.authorize ?? authorizeSession, deps.config ?? readOperatorConfig);
      if (operator instanceof Response) return withPrivateHeaders(operator);
      const expected = requestOrigin(request);
      const origin = request.headers.get("origin");
      const site = request.headers.get("sec-fetch-site");
      if (!expected || !origin || origin !== expected.origin || (site !== null && site !== "same-origin")) return error("CROSS_ORIGIN", 403);
      const { id } = await context.params;
      if (!uuid.test(id)) return error("INVALID_REQUEST", 400);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return error("INVALID_REQUEST", 400);
      const body = await readJsonBody(request, { maxBytes: 16_384 });
      if (body.kind !== "ok") return error("INVALID_REQUEST", 400);
      const parsed = parseRewardDecisionRequest(body.value);
      if (!parsed) return error("INVALID_REQUEST", 400);
      const input = { rewardId: id, actor: operator.address.toLowerCase(), now: new Date() };
      const sql = (deps.sql ?? getSqlExecutor)();
      const result = parsed.action === "approve" ? await approveReward(sql, input) : await rejectReward(sql, { ...input, reason: parsed.reason });
      if (!result.ok) {
        const [code, status] = decisionErrors[result.error];
        return error(code, status);
      }
      return privateJson({ version: GROWTH_ADMIN_CONTRACT_VERSION, state: result.state }, 200);
    } catch {
      emitServerEvent("operator-registry", { route: "/api/admin/growth/rewards/[id]", code: "GROWTH_REWARD_DECISION_FAILED", outcome: "failed" });
      return error("UNAVAILABLE", 503);
    }
  };
}
