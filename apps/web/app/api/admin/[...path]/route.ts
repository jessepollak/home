import { createOperatorApiHandler } from "@/server/operator/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createOperatorApiHandler(false);
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
