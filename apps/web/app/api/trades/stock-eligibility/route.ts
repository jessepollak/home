import { createStockTradeEligibilityHandler } from "@/server/actions/kinds/trade/stock-eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createStockTradeEligibilityHandler();
