"use client";

import { useMemo } from "react";
import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { investViewFromLocation } from "@/client/invest/invest-location";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/client/savings/savings-experience";
import type { CountryCode } from "@/config/regions";
import type { ShellLocation } from "@/config/shell-location";
import { PortfolioHomeExperience } from "./home-experience";

export function DashboardExperience({
  detectedCountry,
  initialLocation,
  initialSearch,
}: {
  detectedCountry: CountryCode | null;
  initialLocation: ShellLocation;
  initialSearch?: string;
}) {
  const discover = useInvestDiscover();
  const initialInvestView = useMemo(
    () => investViewFromLocation(initialLocation),
    [initialLocation],
  );

  return (
    <PortfolioHomeExperience
      detectedCountry={detectedCountry}
      initialPanel={initialLocation.panel}
      initialLocation={initialLocation}
      investContent={
        <PricedInvestExperienceWithDiscover
          discover={discover}
          initialView={initialInvestView}
        />
      }
      savingsContent={<AuthenticatedSavingsExperience />}
      routeMode="dashboard"
      applyInboundUrlIntent
      initialSearch={initialSearch}
    />
  );
}
