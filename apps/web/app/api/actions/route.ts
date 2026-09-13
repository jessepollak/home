import { authorizeSession } from "@/server/auth/authorize";
import { createListActionsHandler } from "@/server/actions/handler";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

export const GET = createListActionsHandler({
  authorize: authorizeSession,
});
