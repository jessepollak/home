import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createPrepareSendMoneyActionHandler } from "@/server/money-actions/prepare-send";
import { withRequestLog } from "@/server/observability/with-request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequestLog(
  "POST /api/actions/send/prepare",
  createPrepareSendMoneyActionHandler({
    authorize: createMoneyActionSessionAuthorizer(),
  }),
);
