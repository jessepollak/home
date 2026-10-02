import { authorizeSession } from "@/server/auth/authorize";
import { createPrepareActionHandler } from "@/server/actions/prepare";


export const POST = createPrepareActionHandler({
  authorize: authorizeSession,
});
