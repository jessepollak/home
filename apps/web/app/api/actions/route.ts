import { authorizeSession } from "@/server/auth/authorize";
import { createListActionsHandler } from "@/server/actions/handler";

export const maxDuration = 15;

export const GET = createListActionsHandler({
  authorize: authorizeSession,
});
