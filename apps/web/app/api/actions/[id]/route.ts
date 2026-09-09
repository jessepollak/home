import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionReadHandler } from "@/server/money-actions/handlers";
import { withRequestLog } from "@/server/observability/with-request-log";
import { getTransferReceipt } from "@/server/transfers/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog(
  "GET /api/actions/:id",
  createMoneyActionReadHandler({
    authorize: createMoneyActionSessionAuthorizer(),
    readReceipt: getTransferReceipt,
  }),
);
