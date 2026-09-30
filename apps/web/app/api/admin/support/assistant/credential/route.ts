import { createSupportCredentialHandlers } from "@/server/support/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createSupportCredentialHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
