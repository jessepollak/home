import { authorizeSession } from "@/server/auth/authorize";
import { createHandleActionHandler } from "@/server/actions/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createHandleActionHandler({
  authorize: authorizeSession,
});
