import type { Metadata } from "next";
import type { ShellPanelId } from "@/config/navigation";
import { DashboardExperience } from "@/client/home/dashboard-experience";
import { parseShellLocation, searchParamsToString } from "@/config/shell-location";

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

/**
 * The one catch-all shell route for every canonical path: /home,
 * /balances[/cash|investments], /activity, /save, /borrow[/market],
 * /invest[/category|asset]. One route tree keeps Next's client-side history
 * tree stable so the optimistic HomeShell persists across Back/Forward.
 * The central parser falls back to the canonical parent for invalid L2
 * segments and to /home for unknown top-level segments.
 */
export default async function ShellPage({
  params,
  searchParams,
}: PageProps<"/[...shell]">) {
  const { shell } = await params;
  const query = await searchParams;
  return (
    <DashboardExperience
      initialLocation={parseShellLocation(shellPathname(shell))}
      initialSearch={searchParamsToString(query)}
    />
  );
}
