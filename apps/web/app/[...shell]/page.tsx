import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ShellPanelId } from "@/config/navigation";
import { PortfolioHomeExperience } from "@/client/home/portfolio-home-experience";
import { parseShellLocation, searchParamsToString } from "@/config/shell-location";
import { readRequestCountry } from "@/server/region/request-country";

const shellTitles: Record<ShellPanelId, string> = {
  home: "Home",
  balances: "Your money",
  activity: "Activity",
  save: "Save",
  borrow: "Borrow",
  invest: "Invest",
};

function shellPathname(shell: readonly string[] | undefined): string {
  return `/${(shell ?? []).join("/")}`;
}

export async function generateMetadata({
  params,
}: PageProps<"/[...shell]">): Promise<Metadata> {
  const { shell } = await params;
  const location = parseShellLocation(shellPathname(shell));
  return {
    title: `${shellTitles[location.panel]} · Home`,
    description: "Your verified Home account.",
  };
}

export default async function ShellPage({
  params,
  searchParams,
}: PageProps<"/[...shell]">) {
  const { shell } = await params;
  const query = await searchParams;
  return (
    <PortfolioHomeExperience
      detectedCountry={readRequestCountry(await headers())}
      initialLocation={parseShellLocation(shellPathname(shell))}
      initialSearch={searchParamsToString(query)}
    />
  );
}
