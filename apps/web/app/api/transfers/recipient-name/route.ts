import { authorizeSession } from "@/server/auth/authorize";
import { createTransferRecipientNameHandler } from "@/server/transfers/handlers";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

export const GET = createTransferRecipientNameHandler({
  authorize: authorizeSession,
});
