"use client";

import { createContext, useContext, type ReactNode } from "react";
import { presentationRegions, type RegionId } from "@/config/regions";
import type {
  MarketPresentationQuote,
  PresentationFxQuote,
} from "@/shared/invest/invest-market";

export type { PresentationFxQuote };

const defaultQuote: MarketPresentationQuote = {
  valueCurrency: "USD",
  quoteUnitsPerUsd: { atoms: "1", scale: 0 },
};

const PresentationQuoteContext =
  createContext<MarketPresentationQuote>(defaultQuote);

const PresentationRegionContext = createContext<RegionId | null>(null);

export function PresentationQuoteProvider({
  value,
  children,
}: {
  value: MarketPresentationQuote;
  children: ReactNode;
}) {
  return (
    <PresentationQuoteContext.Provider value={value}>
      {children}
    </PresentationQuoteContext.Provider>
  );
}

export function PresentationRegionProvider({
  regionId,
  children,
}: {
  regionId: RegionId;
  children: ReactNode;
}) {
  return (
    <PresentationRegionContext.Provider value={regionId}>
      {children}
    </PresentationRegionContext.Provider>
  );
}

export function usePresentationQuote(): MarketPresentationQuote {
  return useContext(PresentationQuoteContext);
}

export function usePresentationRegionId(
  fallback: RegionId = "GLOBAL",
): RegionId {
  return useContext(PresentationRegionContext) ?? fallback;
}

export function presentationQuoteForRegion(
  regionId: RegionId,
  fx: readonly PresentationFxQuote[] | null | undefined,
): MarketPresentationQuote {
  const currency = presentationRegions[regionId].currency.code;
  if (!currency || currency === "USD") {
    return {
      valueCurrency: currency ?? "USD",
      quoteUnitsPerUsd: { atoms: "1", scale: 0 },
    };
  }

  const match = fx?.find(
    (item) => item.quoteCurrency === currency && item.status === "fresh",
  );
  return {
    valueCurrency: currency,
    quoteUnitsPerUsd: match?.quoteUnitsPerUsd ?? null,
  };
}
