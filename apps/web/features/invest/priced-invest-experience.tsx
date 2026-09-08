"use client";

import { InvestExperience } from "./invest-experience";
import { useMarketPrices } from "./use-market-prices";

export function PricedInvestExperience() {
  const marketProps = useMarketPrices();
  return <InvestExperience {...marketProps} />;
}
