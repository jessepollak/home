import { createInvestDiscoverHandler } from "@/server/market-data/handlers/invest-discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createInvestDiscoverHandler();
