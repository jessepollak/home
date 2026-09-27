import { createGetPendingTradeHandler } from "@/server/actions/handler";
import { authorizeSession } from "@/server/auth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createGetPendingTradeHandler({ authorize: authorizeSession });
