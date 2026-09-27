import { createMarketStatsHandler } from "@/server/market-data/handlers/market-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMarketStatsHandler();
