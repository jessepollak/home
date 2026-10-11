import { authorizeRawSession } from "@/server/auth/authorize";
import { createAccountDeletionHandler } from "@/server/account-deletion/handler";

export const maxDuration = 30;
export const GET = createAccountDeletionHandler({ authorize: authorizeRawSession });
export const POST = GET;
