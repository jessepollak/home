import type { Metadata } from "next";
import { readOperatorPageDecision } from "@/server/operator/page";
import { OperatorShell } from "./operator-shell";
import { authorizedOperatorAddress } from "./section-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Home", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorShell address={address}>{children}</OperatorShell>;
}
