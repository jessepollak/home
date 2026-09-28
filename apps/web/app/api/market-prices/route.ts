import { getCodexMarketPrices } from "@/server/market-data/codex/client";
import { getCoinbaseExchangeRates } from "@/server/balances/fx-coinbase";
import { createMarketPricesHandler } from "@/server/market-data/handlers/market-prices";
import { readStockMarket } from "@/server/market-data/tokenized-equity/market-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createMarketPricesHandler(
  getCodexMarketPrices,
  getCoinbaseExchangeRates,
  () => readStockMarket(),
);
