import { createGetPendingTradeHandler } from "@/server/actions/handler";
import { authorizeSession } from "@/server/auth/authorize";


export const GET = createGetPendingTradeHandler({ authorize: authorizeSession });
