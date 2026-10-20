import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { redirect } from "next/navigation";
import { CardPageContent } from "@/client/home/shell-pages";
import { cardJourneyEnabled } from "@/server/cards/bridge/journey-config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Card") };
}

export default function Page() {
  if (!cardJourneyEnabled()) redirect("/home");
  return <CardPageContent />;
}
