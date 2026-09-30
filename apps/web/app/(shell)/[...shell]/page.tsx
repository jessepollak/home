import type { Metadata } from "next";
import { parseShellLocation } from "@/config/shell-location";
import type { ShellPanelId } from "@/config/navigation";
import { ShellFallbackContent } from "@/client/home/shell-pages";

const shellTitles: Record<ShellPanelId, string> = {
  home: "Home",
  card: "Card",
  activity: "Activity",
  cash: "Cash",
  borrow: "Borrow",
  investments: "Investments",
  invest: "Invest",
};

export async function generateMetadata({
  params,
}: PageProps<"/[...shell]">): Promise<Metadata> {
  const { shell } = await params;
  const panel = parseShellLocation(`/${shell.join("/")}`).panel;
  return { title: `${shellTitles[panel]} · Home`, description: "Your verified Home account." };
}

export default function ShellFallbackPage() {
  return <ShellFallbackContent />;
}
