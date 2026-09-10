import type { Metadata } from "next";
import { firstQueryValue, parseShellLocation } from "@/config/shell-location";
import { investViewFromSearch } from "@/features/invest/invest-location";
import { PricedInvestExperience } from "@/features/invest/priced-invest-experience";
import { AuthenticatedSavingsExperience } from "@/features/savings/savings-experience";
import { PortfolioHomeExperience } from "../home-experience";

export const metadata: Metadata = {
  title: "Dashboard · Home",
  description: "Your verified Home account dashboard.",
};

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = await searchParams;
  const location = parseShellLocation(query);
  const returnedFromCoinbase = firstQueryValue(query.return) === "coinbase";
  return (
    <PortfolioHomeExperience
      detectedCountry={null}
      initialPanel={location.panel}
      initialAccountSettingsOpen={location.account === "settings"}
      investContent={<PricedInvestExperience initialView={investViewFromSearch(query)} />}
      savingsContent={<AuthenticatedSavingsExperience />}
      routeMode="dashboard"
      initialAddMoney={firstQueryValue(query["add-money"]) === "1" || returnedFromCoinbase}
      returnedFromCoinbase={returnedFromCoinbase}
    />
  );
}
