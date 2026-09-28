import "server-only";

import { isDiscoverableAsset, stockAssets } from "@/config/invest-assets";
import { atomicToDecimal } from "@/shared/formatting/atomic";
import type { MarketDataState, MarketSnapshot } from "@/shared/invest/invest-market";
import {
  readCurrentTokenizedEquityReferences,
  tokenizedEquityFeeds,
  type TokenizedEquityFeed,
  type TokenizedEquityReference,
} from "./reader";

export const TOKENIZED_EQUITY_PRICE_SOURCE_LABEL = "Chainlink";
export const TOKENIZED_EQUITY_PRICE_SOURCE_URL =
  "https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase";

type StockReferencesReader = (
  feeds: readonly TokenizedEquityFeed[],
) => Promise<readonly TokenizedEquityReference[]>;

const source = {
  sourceLabel: TOKENIZED_EQUITY_PRICE_SOURCE_LABEL,
  sourceUrl: TOKENIZED_EQUITY_PRICE_SOURCE_URL,
};

export function stockMarketSnapshots(
  references: readonly TokenizedEquityReference[],
): MarketSnapshot[] {
  return references.flatMap((reference): MarketSnapshot[] => {
    switch (reference.status) {
      case "open":
      case "closed":
        return [{
          assetId: reference.assetId,
          displayPrice: `$${atomicToDecimal(reference.price.atoms, reference.price.scale)}`,
          asOf: reference.updatedAt,
          ...source,
          session: reference.status,
          checkedAt: reference.block.timestamp,
        }];
      case "paused":
      case "stale":
        return [{
          assetId: reference.assetId,
          displayPrice: "—",
          asOf: reference.updatedAt ?? reference.block.timestamp,
          ...source,
          session: reference.status,
          checkedAt: reference.block.timestamp,
        }];
      case "unavailable":
        return [];
    }
  });
}

export async function readStockMarket(
  readReferences: StockReferencesReader = readCurrentTokenizedEquityReferences,
): Promise<MarketDataState> {
  const feeds = tokenizedEquityFeeds(stockAssets.filter(isDiscoverableAsset));
  try {
    const references = await readReferences(feeds);
    if (feeds.length > 0 && references.every(({ status }) => status === "unavailable")) {
      return { status: "error", message: "Current market prices are unavailable." };
    }
    return { status: "ready", snapshots: stockMarketSnapshots(references) };
  } catch {
    return { status: "error", message: "Current market prices are unavailable." };
  }
}
