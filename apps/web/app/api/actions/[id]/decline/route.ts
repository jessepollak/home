import { authorizeSession } from "@/server/auth/authorize";
import { createDeclineActionHandler } from "@/server/actions/handler";


export const POST = createDeclineActionHandler({ authorize: authorizeSession });
