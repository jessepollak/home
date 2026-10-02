import { createSupportCredentialHandlers } from "@/server/support/handlers";

const handlers = createSupportCredentialHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
