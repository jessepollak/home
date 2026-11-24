import { createOperatorApiHandler, createOperatorGrantHandler } from "@/server/operator/api";

export const GET = createOperatorApiHandler(true);
export const POST = createOperatorGrantHandler();
