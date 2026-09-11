"use client";

import {
  getMarketDisplay,
  type MarketDataState,
  type MarketDisplay,
} from "@/shared/invest/invest-market";
import { usePresentationQuote } from "./presentation-quote";

export function useMarketDisplay(
  assetId: string,
  market: MarketDataState,
): MarketDisplay {
  return getMarketDisplay(assetId, market, usePresentationQuote());
}
