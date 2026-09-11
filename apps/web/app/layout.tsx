import type { Metadata } from "next";
import { dmMono, dmSans } from "@home/ui/next-font";
import { brand } from "@/config/brand";
import { CdpAccountProvider } from "@/client/account/cdp-client";
import { SmokeFixtureAccountProvider } from "@/client/account/smoke-fixture-provider";
import { normalizeProjectId } from "@/client/account/session-client";
import { isBaseAccountEnabled } from "@/shared/account/session-types";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.name} · local money preview`,
  description: brand.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const accountProvider = process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL ? (
    <SmokeFixtureAccountProvider>{children}</SmokeFixtureAccountProvider>
  ) : (
    <CdpAccountProvider
      projectId={normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID)}
      baseAccountEnabled={isBaseAccountEnabled(
        process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
      )}
    >
      {children}
    </CdpAccountProvider>
  );

  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}>
      <body className="min-h-full">{accountProvider}</body>
    </html>
  );
}
