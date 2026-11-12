import type { Metadata } from "next";
import { brandedPageTitle } from "@/server/operator-settings/brand";
import { readOperatorPageDecision } from "@/server/operator/page";
import { OperatorShell } from "./operator-shell";
import { authorizedOperatorAddress } from "./section-content";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await brandedPageTitle("Admin"), robots: { index: false, follow: false } };
}

export const instant = false;

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorShell address={address}>{children}</OperatorShell>;
}
