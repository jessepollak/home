"use client";

import { useMemo, useState } from "react";
import {
  readAnonymousCountryPreference,
} from "@/config/country-preference";
import {
  resolvePresentation,
  type RegionId,
} from "@/config/regions";
import { InvestExperience, type InvestExperienceProps } from "./invest-experience";
import {
  PresentationQuoteProvider,
  presentationQuoteForRegion,
  usePresentationRegionId,
} from "./presentation-quote";
import {

  type UseInvestDiscoverResult,
} from "./use-invest-discover";
import { useMarketPrices } from "./use-market-prices";

export function PricedInvestExperienceWithDiscover({
  initialView,
  investVisibility,
  discover,
}: Pick<InvestExperienceProps, "initialView" | "investVisibility"> & {
  discover: UseInvestDiscoverResult;
}) {
  const persistedRegion = usePersistedPresentationRegion();
  const regionId = usePresentationRegionId(persistedRegion);
  const { fx, ...marketProps } = useMarketPrices();
  const quote = useMemo(
    () => presentationQuoteForRegion(regionId, fx),
    [fx, regionId],
  );

  return (
    <PresentationQuoteProvider value={quote}>
      <InvestExperience
        {...marketProps}
        initialView={initialView}
        investVisibility={investVisibility}
        memeMarket={discover.memeMarket}
        memeAssets={discover.memeAssets}
        memeStatus={discover.memeStatus}
        assetMarkResolution={discover.assetMarkResolution}
        memePagination={discover.memePagination}
        onLoadMoreMemes={discover.loadMoreMemes}
        onRetryLoadMoreMemes={discover.retryLoadMoreMemes}
      />
    </PresentationQuoteProvider>
  );
}

function usePersistedPresentationRegion(): RegionId {
  const [regionId] = useState<RegionId>(() => {
    if (typeof window === "undefined") return resolvePresentation({}).region.id;
    return resolvePresentation({
      persistedCountry: readAnonymousCountryPreference(
        () => window.localStorage,
      ).country,
    }).region.id;
  });
  return regionId;
}
