import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionStatusHandler } from "@/server/money-actions/handlers";
import { withRequestLog } from "@/server/observability/with-request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequestLog(
  "POST /api/actions/:id/status",
  createMoneyActionStatusHandler({
    authorize: createMoneyActionSessionAuthorizer(),
  }),
);
