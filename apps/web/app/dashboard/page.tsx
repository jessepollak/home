import type { Metadata } from "next";
import { parseShellLocation } from "@/config/shell-location";
import { investViewFromSearch } from "@/features/invest/invest-location";
import { DashboardExperience } from "./dashboard-experience";

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
  return (
    <DashboardExperience
      initialPanel={location.panel}
      initialAccountSettingsOpen={location.account === "settings"}
      initialInvestView={investViewFromSearch(query)}
    />
  );
}
