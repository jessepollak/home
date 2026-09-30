import { authorizeSession } from "@/server/auth/authorize";
import { createRecentTransferRecipientsHandler } from "@/server/transfers/handlers";

export const maxDuration = 15;

export const GET = createRecentTransferRecipientsHandler({
  authorize: authorizeSession,
});
