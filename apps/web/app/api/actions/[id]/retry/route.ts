import { authorizeSession } from "@/server/auth/authorize";
import { createRetryActionHandler } from "@/server/actions/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createRetryActionHandler({ authorize: authorizeSession });
