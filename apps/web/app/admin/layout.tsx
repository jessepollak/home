import type { Metadata } from "next";
import { cookies } from "next/headers";
import { OperatorEmailAccess } from "@/client/admin/operator-email-access";
import { normalizeProjectId } from "@/client/account/session-client";
import { readRenderSession } from "@/server/auth/render-session";
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
  if (address && decision.kind === "operator" && decision.provider === "base-account") {
    return <OperatorShell address={address}>{children}</OperatorShell>;
  }
  const provider = {
    projectId: normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID),
    smokeFixture: process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL,
    renderSeed: await readRenderSession(await cookies()),
  };
  if (!address) return <OperatorEmailAccess granted={false} {...provider} />;
  return (
    <OperatorEmailAccess granted {...provider}>
      <OperatorShell address={address}>{children}</OperatorShell>
    </OperatorEmailAccess>
  );
}
