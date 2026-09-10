import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createClaimMoneyActionHandler } from "@/server/money-actions/handlers";
import { validateTradeBeforeClaim } from "@/server/trading/preclaim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createClaimMoneyActionHandler({
  authorize: createMoneyActionSessionAuthorizer(),
  validateBeforeClaim: validateTradeBeforeClaim,
});
