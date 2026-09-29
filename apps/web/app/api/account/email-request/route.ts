import { authorizeSession } from "@/server/auth/authorize";
import { createEmailRequestReadHandler, createEmailRequestWriteHandler } from "@/server/customers/email-request-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createEmailRequestReadHandler({ authorize: authorizeSession });
export const POST = createEmailRequestWriteHandler({ authorize: authorizeSession });
