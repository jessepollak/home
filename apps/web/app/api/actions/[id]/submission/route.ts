import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionSubmissionHandler } from "@/server/money-actions/handlers";
import { withRequestLog } from "@/server/observability/with-request-log";
import { getTransferReceipt } from "@/server/transfers/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequestLog(
  "POST /api/actions/:id/submission",
  createMoneyActionSubmissionHandler({
    authorize: createMoneyActionSessionAuthorizer(),
    readReceipt: getTransferReceipt,
  }),
);
