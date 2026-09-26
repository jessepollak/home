import { authorizeSession } from "@/server/auth/authorize";
import { createDeclineActionHandler } from "@/server/actions/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createDeclineActionHandler({ authorize: authorizeSession });
