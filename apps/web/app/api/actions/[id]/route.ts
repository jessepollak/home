import { authorizeSession } from "@/server/auth/authorize";
import { createGetActionHandler } from "@/server/actions/handler";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

export const GET = createGetActionHandler({
  authorize: authorizeSession,
});
