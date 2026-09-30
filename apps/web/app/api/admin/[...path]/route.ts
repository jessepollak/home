import { createOperatorApiHandler } from "@/server/operator/api";


const handle = createOperatorApiHandler(false);
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
