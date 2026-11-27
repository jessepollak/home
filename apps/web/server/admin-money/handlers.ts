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
  MONEY_EXPORT_BATCH_ROWS,
  MONEY_EXPORT_HEADER,
  MONEY_EXPORT_MAX_ROWS,
  moneyExportFilename,
  moneyMovementsCsvRows,
  parseMoneyExportRequest,
  type AdminMoneyErrorCode,
  type MoneyExportRange,
} from "@/shared/admin-money/contract";
import { listMoneyMovements, readMoneyExportHead } from "./movements";

const ROUTE = "/api/admin/money/export";
const QUERY_TIMEOUT_MS = 5_000;

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

function csvStream(sql: SqlExecutor, range: MoneyExportRange, through: string | null, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let before: string | null = null;
  let started = false;
  let done = through === null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(MONEY_EXPORT_HEADER));
        if (done) controller.close();
        return;
      }
      try {
        const page = await listMoneyMovements(sql, { range, limit: MONEY_EXPORT_BATCH_ROWS, before, through }, { timeoutMs: QUERY_TIMEOUT_MS, signal });
        if (page.rows.length) controller.enqueue(encoder.encode(moneyMovementsCsvRows(page.rows)));
        before = page.next;
        done = before === null;
        if (done) controller.close();
      } catch (error) {
        emitServerEvent("operator-registry", { route: ROUTE, code: "MONEY_EXPORT_INTERRUPTED", outcome: "failed" });
        controller.error(error);
      }
    },
  });
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
      const head = await readMoneyExportHead(sql, range, { timeoutMs: QUERY_TIMEOUT_MS, signal: request.signal });
      if (head.rows > MONEY_EXPORT_MAX_ROWS) return fail("EXPORT_TOO_LARGE", 422);
      await new AdminAuditLog(sql).recordMoneyExport({ actor, range, rows: head.rows });
      const response = withPrivateHeaders(new Response(csvStream(sql, range, head.through, request.signal), { status: 200 }));
      response.headers.set("Content-Type", "text/csv; charset=utf-8");
      response.headers.set("Content-Disposition", `attachment; filename="${moneyExportFilename(range)}"`);
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch {
      return fail("MONEY_UNAVAILABLE", 503);
    }
  };
}
