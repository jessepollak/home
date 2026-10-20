import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { HomePageContent } from "@/client/home/shell-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Home") };
}

export default function Page() {
  return <HomePageContent />;
}
