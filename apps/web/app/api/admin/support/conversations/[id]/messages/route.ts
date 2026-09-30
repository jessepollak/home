import { createOperatorSupportReplyHandler } from "@/server/support/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOperatorSupportReplyHandler();
