import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CardPageContent } from "@/client/home/shell-pages";
import { cardJourneyEnabled } from "@/server/cards/bridge/journey-config";

export const metadata: Metadata = { title: "Card · Home", description: "Your verified Home account." };

export default function Page() {
  if (!cardJourneyEnabled()) redirect("/home");
  return <CardPageContent />;
}
