"use client";

import { createContext, useContext, type ReactNode } from "react";
import { presentationRegions, type FiatCurrencyCode, type RegionId } from "@/config/regions";
import { countryDefaultCurrency, type PresentationScope } from "@/shared/account/display-currency";
import type {
  MarketPresentationQuote,
  PresentationFxQuote,
} from "@/shared/invest/invest-market";

export type { PresentationFxQuote };

const defaultQuote: MarketPresentationQuote = {
  regionId: "GLOBAL",
  valueCurrency: "USD",
  quoteUnitsPerUsd: { atoms: "1", scale: 0 },
};

const PresentationQuoteContext =
  createContext<MarketPresentationQuote>(defaultQuote);

const PresentationRegionContext = createContext<RegionId | null>(null);

const PresentationCurrencyContext = createContext<FiatCurrencyCode | null | undefined>(undefined);

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
  currency,
  children,
}: {
  regionId: RegionId;
  currency?: FiatCurrencyCode | null;
  children: ReactNode;
}) {
  return (
    <PresentationRegionContext.Provider value={regionId}>
      <PresentationCurrencyContext.Provider value={currency}>
        {children}
      </PresentationCurrencyContext.Provider>
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

export function usePresentationCurrency(
  fallbackRegion: RegionId = "GLOBAL",
): FiatCurrencyCode | null {
  const provided = useContext(PresentationCurrencyContext);
  const region = useContext(PresentationRegionContext) ?? fallbackRegion;
  return provided === undefined ? countryDefaultCurrency(region) : provided;
}

export function usePresentationScope(
  fallbackRegion: RegionId = "GLOBAL",
): PresentationScope {
  const region = usePresentationRegionId(fallbackRegion);
  return { region, currency: usePresentationCurrency(region) };
}

export function presentationQuoteForRegion(
  regionId: RegionId,
  fx: readonly PresentationFxQuote[] | null | undefined,
  displayCurrency?: FiatCurrencyCode | null,
): MarketPresentationQuote {
  const currency = displayCurrency === undefined
    ? presentationRegions[regionId].currency.code
    : displayCurrency;
  if (!currency || currency === "USD") {
    return {
      regionId,
      valueCurrency: currency ?? "USD",
      quoteUnitsPerUsd: { atoms: "1", scale: 0 },
    };
  }

  const match = fx?.find(
    (item) => item.quoteCurrency === currency && item.status === "fresh",
  );
  return {
    regionId,
    valueCurrency: currency,
    quoteUnitsPerUsd: match?.quoteUnitsPerUsd ?? null,
  };
}
