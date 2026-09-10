import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionStatusHandler } from "@/server/money-actions/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createMoneyActionStatusHandler({
  authorize: createMoneyActionSessionAuthorizer(),
});
