import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { firstQueryValue } from "@/config/shell-location";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Add money") };
}

export const instant = false;

export default async function FundPage({
  searchParams,
}: PageProps<"/fund">) {
  const query = await searchParams;
  const params = new URLSearchParams({ "add-money": "1" });
  const fundingReturn = firstQueryValue(query.return);
  if (fundingReturn === "funding" || fundingReturn === "verification") {
    params.set("return", fundingReturn);
  }
  redirect(`/home?${params.toString()}`);
}
