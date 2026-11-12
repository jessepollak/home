import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brandedPageTitle } from "@/server/operator-settings/brand";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Account") };
}

export default function AccountPage() {
  redirect("/?account=signin");
}
