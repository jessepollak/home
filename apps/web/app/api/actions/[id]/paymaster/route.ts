import { createPaymasterProxyHandler } from "@/server/paymaster/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPaymasterProxyHandler();
