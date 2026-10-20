import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { ActivityPageContent } from "@/client/home/shell-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Activity") };
}

export default function Page() {
  return <ActivityPageContent />;
}
