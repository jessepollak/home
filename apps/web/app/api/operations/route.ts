import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionListHandler } from "@/server/money-actions/handlers";
import { withRequestLog } from "@/server/observability/with-request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog(
  "GET /api/operations",
  createMoneyActionListHandler({
    authorize: createMoneyActionSessionAuthorizer(),
  }),
);
