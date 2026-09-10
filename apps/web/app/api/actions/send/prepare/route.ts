import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createPrepareSendMoneyActionHandler } from "@/server/money-actions/prepare-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPrepareSendMoneyActionHandler({
  authorize: createMoneyActionSessionAuthorizer(),
});
