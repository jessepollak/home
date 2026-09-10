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
import { useInvestDiscover } from "./use-invest-discover";
import { useMarketPrices } from "./use-market-prices";

export function PricedInvestExperience({
  initialView,
}: Pick<InvestExperienceProps, "initialView"> = {}) {
  const persistedRegion = usePersistedPresentationRegion();
  const regionId = usePresentationRegionId(persistedRegion);
  const { fx, ...marketProps } = useMarketPrices();
  const discover = useInvestDiscover();
  const quote = useMemo(
    () => presentationQuoteForRegion(regionId, fx),
    [fx, regionId],
  );

  return (
    <PresentationQuoteProvider value={quote}>
      <InvestExperience
        {...marketProps}
        initialView={initialView}
        memeMarket={discover.memeMarket}
        memeAssets={discover.memeAssets}
        memeStatus={discover.memeStatus}
        assetIcons={discover.assetIcons}
        iconsPending={discover.iconsPending}
      />
    </PresentationQuoteProvider>
  );
}

function usePersistedPresentationRegion(): RegionId {
  const [regionId] = useState<RegionId>(() => {
    if (typeof window === "undefined") return "GLOBAL";
    return resolvePresentation({
      persistedCountry: readAnonymousCountryPreference(
        () => window.localStorage,
      ),
    }).region.id;
  });
  return regionId;
}
