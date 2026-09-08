"use client";

import { InvestExperience, type InvestExperienceProps } from "./invest-experience";
import { useInvestDiscover } from "./use-invest-discover";
import { useMarketPrices } from "./use-market-prices";

export function PricedInvestExperience({
  initialView,
}: Pick<InvestExperienceProps, "initialView"> = {}) {
  const marketProps = useMarketPrices();
  const discover = useInvestDiscover();
  return (
    <InvestExperience
      {...marketProps}
      initialView={initialView}
      memeMarket={discover.memeMarket}
      memeAssets={discover.memeAssets}
      memeStatus={discover.memeStatus}
      assetIcons={discover.assetIcons}
    />
  );
}
