import { getCodexMarketPrices } from "@/server/market-data/codex/client";
import { getCoinbaseExchangeRates } from "@/server/valuation/fx-coinbase";
import { createMarketPricesHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMarketPricesHandler(
  getCodexMarketPrices,
  getCoinbaseExchangeRates,
);
