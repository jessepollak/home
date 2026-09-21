import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { firstQueryValue } from "@/config/shell-location";

export const metadata: Metadata = {
  title: "Add money · Home",
  description: "Fund your verified Home Base account.",
};

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
