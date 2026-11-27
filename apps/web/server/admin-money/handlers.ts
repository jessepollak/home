import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { privateJson, withPrivateHeaders } from "@/server/http/private-response";
import { readSameOriginJson } from "@/server/http/same-origin-mutation";
import { emitServerEvent } from "@/server/observability/log";
import { authorizeOperatorRequest } from "@/server/operator/api";
import { readOperatorConfig, type OperatorConfig } from "@/server/operator/config";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  MONEY_EXPORT_MAX_ROWS,
  moneyExportFilename,
  moneyMovementsCsv,
  parseMoneyExportRequest,
  type AdminMoneyErrorCode,
} from "@/shared/admin-money/contract";
import { listMoneyMovements } from "./movements";

const ROUTE = "/api/admin/money/export";

type Dependencies = {
  authorize?: (request: Request) => Promise<VerifiedAccountSession | Response>;
  config?: () => OperatorConfig;
  sql?: () => SqlExecutor | null;
};

function fail(code: AdminMoneyErrorCode, status: number): Response {
  emitServerEvent("operator-registry", { route: ROUTE, code, outcome: "failed" });
  return privateJson({ error: { code } }, status);
}

function database(deps: Dependencies): SqlExecutor | null {
  if (deps.sql) return deps.sql();
  return readDatabaseUrl() ? getSqlExecutor() : null;
}

export function createMoneyExportHandler(deps: Dependencies = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      const actor = await authorizeOperatorRequest(request, (operator) => operator.value, deps.authorize ?? authorizeSession, deps.config ?? readOperatorConfig);
      if (actor instanceof Response) return withPrivateHeaders(actor);
      const checked = await readSameOriginJson(request);
      if ("error" in checked) return fail(checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
      const parsed = parseMoneyExportRequest(checked.value);
      if (!parsed) return fail("INVALID_REQUEST", 400);
      const sql = database(deps);
      if (!sql) return fail("MONEY_NOT_CONFIGURED", 503);
      const range = { from: parsed.from, to: parsed.to };
      const csv = await sql.transaction(async (tx) => {
        const rows = await listMoneyMovements(tx, { range, limit: MONEY_EXPORT_MAX_ROWS + 1 });
        if (rows.length > MONEY_EXPORT_MAX_ROWS) return null;
        await new AdminAuditLog(tx).recordMoneyExport({ actor, range, rows: rows.length });
        return moneyMovementsCsv(rows);
      });
      if (csv === null) return fail("EXPORT_TOO_LARGE", 422);
      const response = withPrivateHeaders(new Response(csv, { status: 200 }));
      response.headers.set("Content-Type", "text/csv; charset=utf-8");
      response.headers.set("Content-Disposition", `attachment; filename="${moneyExportFilename(range)}"`);
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch {
      return fail("MONEY_UNAVAILABLE", 503);
    }
  };
}
