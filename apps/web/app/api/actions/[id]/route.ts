import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionReadHandler } from "@/server/money-actions/handlers";
import { getTransferReceipt } from "@/server/transfers/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMoneyActionReadHandler({
  authorize: createMoneyActionSessionAuthorizer(),
  readReceipt: getTransferReceipt,
});
