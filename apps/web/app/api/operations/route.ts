import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionListHandler } from "@/server/money-actions/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMoneyActionListHandler({
  authorize: createMoneyActionSessionAuthorizer(),
});
