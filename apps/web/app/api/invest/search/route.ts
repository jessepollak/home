import { createInvestSearchHandler } from "@/server/market-data/handlers/invest-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createInvestSearchHandler();
