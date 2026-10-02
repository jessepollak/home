import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { InvestPageContent } from "@/client/home/shell-pages";
import { readProductOffering } from "@/server/operator-settings/offering";

export const metadata: Metadata = { title: "Invest · Home", description: "Your verified Home account." };

export default function Page() {
  return <Suspense fallback={null}><OfferedInvestPage /></Suspense>;
}

async function OfferedInvestPage() {
  await connection();
  if ((await readProductOffering()).products.invest !== "on") redirect("/home");
  return <InvestPageContent />;
}
