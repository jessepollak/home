import { authorizeSession } from "@/server/auth/authorize";
import { createGetActionHandler } from "@/server/actions/handler";

export const maxDuration = 15;

export const GET = createGetActionHandler({
  authorize: authorizeSession,
});
