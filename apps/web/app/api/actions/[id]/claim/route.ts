import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createClaimMoneyActionHandler } from "@/server/money-actions/handlers";
import { withRequestLog } from "@/server/observability/with-request-log";
import { validateTradeBeforeClaim } from "@/server/trading/preclaim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequestLog(
  "POST /api/actions/:id/claim",
  createClaimMoneyActionHandler({
    authorize: createMoneyActionSessionAuthorizer(),
    validateBeforeClaim: validateTradeBeforeClaim,
  }),
);
