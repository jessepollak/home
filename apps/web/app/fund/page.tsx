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
  if (firstQueryValue(query.return) === "coinbase") {
    params.set("return", "coinbase");
  }
  redirect(`/dashboard?${params.toString()}`);
}
