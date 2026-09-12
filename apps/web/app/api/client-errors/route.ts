import { createClientErrorHandler } from "@/server/observability/client-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createClientErrorHandler();
