import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { CashPageContent } from "@/client/home/shell-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Savings") };
}

export default function Page() {
  return <CashPageContent />;
}
