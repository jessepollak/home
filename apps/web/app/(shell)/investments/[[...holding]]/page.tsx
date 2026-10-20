import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { InvestmentsPageContent } from "@/client/home/shell-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Investments") };
}

export default function Page() {
  return <InvestmentsPageContent />;
}
