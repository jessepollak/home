import { createClientPerformanceHandler } from "@/server/observability/client-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createClientPerformanceHandler();
