import { createOperatorApiHandler } from "@/server/operator/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createOperatorApiHandler(true);
