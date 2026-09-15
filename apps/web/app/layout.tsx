import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { CdpAccountProvider } from "@/client/account/cdp-client";
import { normalizeProjectId } from "@/client/account/session-client";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { HomeQueryClientProvider } from "@/client/query/query-client";
import { HomeSpeedInsights } from "@/client/observability/home-speed-insights";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.name} · local money preview`,
  description: brand.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const accountProvider = (
    <CdpAccountProvider
      projectId={normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID)}
      baseAccountEnabled={isHomeSessionConfigured(process.env.HOME_SESSION_SECRET)}
      smokeFixture={process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL}
    >
      {children}
    </CdpAccountProvider>
  );

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <HomeQueryClientProvider>{accountProvider}</HomeQueryClientProvider>
        <HomeSpeedInsights />
      </body>
    </html>
  );
}
