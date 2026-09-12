import { getCodexMarketPrices } from "@/server/market-data/codex/client";
import { getCoinbaseExchangeRates } from "@/server/portfolio/fx-coinbase";
import { createMarketPricesHandler } from "@/server/market-data/handlers/market-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMarketPricesHandler(
  getCodexMarketPrices,
  getCoinbaseExchangeRates,
);
