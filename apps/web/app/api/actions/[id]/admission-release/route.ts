import { createMoneyActionSessionAuthorizer } from "@/server/money-actions/composition";
import { createMoneyActionAdmissionReleaseHandler } from "@/server/money-actions/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createMoneyActionAdmissionReleaseHandler({
  authorize: createMoneyActionSessionAuthorizer(),
});
