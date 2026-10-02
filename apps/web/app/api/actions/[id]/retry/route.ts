import { authorizeSession } from "@/server/auth/authorize";
import { createRetryActionHandler } from "@/server/actions/handler";


export const POST = createRetryActionHandler({ authorize: authorizeSession });
