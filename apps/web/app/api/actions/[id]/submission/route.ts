import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionSubmissionHandler } from "@/server/money-actions/handlers";
import { getTransferReceipt } from "@/server/transfers/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createMoneyActionSubmissionHandler({
  authorize: createMoneyActionSessionAuthorizer(),
  readReceipt: getTransferReceipt,
});
