import type { Metadata } from "next";
import { DashboardExperience } from "@/client/home/dashboard-experience";
import { searchParamsToString } from "@/config/shell-location";

export const metadata: Metadata = {
  title: "Dashboard · Home",
  description: "Your verified Home account dashboard.",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const query = await searchParams;
  return <DashboardExperience initialSearch={searchParamsToString(query)} />;
}
