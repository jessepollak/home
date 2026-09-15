"use client";

import { useMemo } from "react";
import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { investViewFromLocation } from "@/client/invest/invest-location";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/client/savings/savings-experience";
import { parseShellLocation } from "@/config/shell-location";
import { PortfolioHomeExperience } from "./home-experience";

export function DashboardExperience({ initialSearch }: { initialSearch?: string } = {}) {
  const discover = useInvestDiscover();
  // The dashboard page serializes its request query into `initialSearch`. Parse it
  // with the canonical shell parser so SSR and the first hydrated render select the
  // same panel and Invest view directly from server data — never window.location,
  // which the server cannot see and which would first paint Home and flash (#460).
  const location = useMemo(
    () => parseShellLocation(new URLSearchParams(initialSearch ?? "")),
    [initialSearch],
  );
  const initialInvestView = useMemo(
    () => investViewFromLocation(location),
    [location],
  );

  return (
    <PortfolioHomeExperience
      detectedCountry={null}
      initialPanel={location.panel}
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
