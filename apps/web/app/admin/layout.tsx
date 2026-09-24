import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readOperatorPageDecision } from "@/server/operator/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Home", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const decision = await readOperatorPageDecision();
  if (decision.kind === "unauthenticated") redirect("/?account=signin");
  if (decision.kind === "forbidden") redirect("/home");
  return children;
}
