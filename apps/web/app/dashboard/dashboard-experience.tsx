"use client";

import type { ShellPanelId } from "@/config/navigation";
import type { InvestView } from "@/features/invest/invest-experience";
import { PricedInvestExperienceWithDiscover } from "@/features/invest/priced-invest-experience";
import { useInvestDiscover } from "@/features/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/features/savings/savings-experience";
import { PortfolioHomeExperience } from "../home-experience";

export function DashboardExperience({
  initialPanel,
  initialAccountSettingsOpen,
  initialInvestView,
  initialAddMoney,
  returnedFromCoinbase,
}: {
  initialPanel: ShellPanelId;
  initialAccountSettingsOpen: boolean;
  initialInvestView: InvestView;
  initialAddMoney: boolean;
  returnedFromCoinbase: boolean;
}) {
  const discover = useInvestDiscover();

  return (
    <PortfolioHomeExperience
      detectedCountry={null}
      initialPanel={initialPanel}
      initialAccountSettingsOpen={initialAccountSettingsOpen}
      assetMarkResolution={discover.assetMarkResolution}
      investContent={
        <PricedInvestExperienceWithDiscover
          initialView={initialInvestView}
          discover={discover}
        />
      }
      savingsContent={<AuthenticatedSavingsExperience />}
      routeMode="dashboard"
      initialAddMoney={initialAddMoney}
      returnedFromCoinbase={returnedFromCoinbase}
    />
  );
}
