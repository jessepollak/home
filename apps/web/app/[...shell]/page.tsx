import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { ShellPanelId } from "@/config/navigation";
import { PortfolioHomeExperience } from "@/client/home/portfolio-home-experience";
import { legacyShellRedirectHref, parseShellLocation, searchParamsToString } from "@/config/shell-location";
import { readRequestCountry } from "@/server/region/request-country";
import { readRenderSession } from "@/server/auth/render-session";
import { readShellPolicyForRender } from "@/server/operator-settings/shell-policy";
import { cardJourneyEnabled } from "@/server/cards/bridge/journey-config";

const shellTitles: Record<ShellPanelId, string> = {
  home: "Home",
  card: "Card",
  balances: "Your money",
  activity: "Activity",
  cash: "Cash",
  borrow: "Borrow",
  investments: "Investments",
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
  const legacyHref = legacyShellRedirectHref(shellPathname(shell), query);
  if (legacyHref) redirect(legacyHref);
  const initialLocation = parseShellLocation(shellPathname(shell));
  const cardsEnabled = cardJourneyEnabled();
  if (initialLocation.panel === "card" && !cardsEnabled) redirect("/home");
  const rendered = readRenderSession(await cookies());
  const { accountPreference, investVisibility, regionOffer } = await readShellPolicyForRender(rendered?.session ?? null);
  return (
    <PortfolioHomeExperience
      detectedCountry={readRequestCountry(await headers())}
      regionOffer={regionOffer}
      accountPreference={accountPreference}
      initialLocation={initialLocation}
      cardsEnabled={cardsEnabled}
      investVisibility={investVisibility}
      initialSearch={searchParamsToString(query)}
    />
  );
}
