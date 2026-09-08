"use client";

import { InvestExperience, type InvestExperienceProps } from "./invest-experience";
import { useMarketPrices } from "./use-market-prices";

export function PricedInvestExperience({
  initialView,
}: Pick<InvestExperienceProps, "initialView"> = {}) {
  const marketProps = useMarketPrices();
  return <InvestExperience {...marketProps} initialView={initialView} />;
}
