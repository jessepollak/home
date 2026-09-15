"use client";

import { useMemo } from "react";
import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { investViewFromLocation } from "@/client/invest/invest-location";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/client/savings/savings-experience";
import type { ShellLocation } from "@/config/shell-location";
import { PortfolioHomeExperience } from "./home-experience";

export function DashboardExperience({
  initialLocation,
  initialSearch,
}: {
  initialLocation: ShellLocation;
  initialSearch?: string;
}) {
  const discover = useInvestDiscover();
  // The canonical shell page validates the URL pathname into an explicit
  // location, so SSR and the first hydrated render select the same panel and
  // Invest view directly from server data — never window.location, which the
  // server cannot see and which would first paint Home and flash (#460).
  const initialInvestView = useMemo(
    () => investViewFromLocation(initialLocation),
    [initialLocation],
  );

  return (
    <PortfolioHomeExperience
      detectedCountry={null}
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
