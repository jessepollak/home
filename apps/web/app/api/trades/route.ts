import { createTradeAvailabilityHandler } from "@/server/actions/kinds/trade/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createTradeAvailabilityHandler();
