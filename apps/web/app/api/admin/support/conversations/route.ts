import { createOperatorSupportListHandler } from "@/server/support/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createOperatorSupportListHandler();
