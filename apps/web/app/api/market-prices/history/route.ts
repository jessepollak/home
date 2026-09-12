import { createMarketPriceHistoryHandler } from "@/server/market-data/handlers/market-price-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMarketPriceHistoryHandler();
