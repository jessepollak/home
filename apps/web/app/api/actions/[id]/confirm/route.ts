import { authorizeSession } from "@/server/auth/authorize";
import { createConfirmActionHandler } from "@/server/actions/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createConfirmActionHandler({
  authorize: authorizeSession,
});
