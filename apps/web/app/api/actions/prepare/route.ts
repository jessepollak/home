import { authorizeSession } from "@/server/auth/authorize";
import { createPrepareActionHandler } from "@/server/actions/prepare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPrepareActionHandler({
  authorize: authorizeSession,
});
