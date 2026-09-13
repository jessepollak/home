"use client";

import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/client/savings/savings-experience";
import { PortfolioHomeExperience } from "./home-experience";

export function DashboardExperience({ initialSearch }: { initialSearch?: string } = {}) {
  const discover = useInvestDiscover();

  return (
    <PortfolioHomeExperience
      detectedCountry={null}
      assetMarkResolution={discover.assetMarkResolution}
      investContent={
        <PricedInvestExperienceWithDiscover discover={discover} />
      }
      savingsContent={<AuthenticatedSavingsExperience />}
      routeMode="dashboard"
      applyInboundUrlIntent
      initialSearch={initialSearch}
    />
  );
}
