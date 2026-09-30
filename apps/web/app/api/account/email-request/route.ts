import { authorizeSession } from "@/server/auth/authorize";
import { createEmailRequestReadHandler, createEmailRequestWriteHandler } from "@/server/customers/email-request-handler";

export const GET = createEmailRequestReadHandler({ authorize: authorizeSession });
export const POST = createEmailRequestWriteHandler({ authorize: authorizeSession });
