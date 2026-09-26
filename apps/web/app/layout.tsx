import type { Metadata } from "next";
import { cookies } from "next/headers";
import { brand } from "@/config/brand";
import { AccountRouteProvider } from "@/client/account/account-route-provider";
import { normalizeProjectId } from "@/client/account/session-client";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { readRenderSession } from "@/server/auth/render-session";
import { HomeQueryClientProvider } from "@/client/query/query-client";
import { HomeSpeedInsights } from "@/client/observability/home-speed-insights";
import { AgentationOverlay } from "@/client/observability/agentation-overlay";
import { AppearanceSync } from "@/client/appearance/use-appearance";
import { appearanceBootScript } from "@/client/appearance/boot-script";
import { appearanceThemeColors } from "@/shared/appearance/preference";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.name} · local money preview`,
  description: brand.description,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const smokeFixture = process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL;
  const renderSeed = smokeFixture ? null : readRenderSession(await cookies());
  const accountProvider = (
    <AccountRouteProvider
      projectId={normalizeProjectId(process.env.NEXT_PUBLIC_CDP_PROJECT_ID)}
      baseAccountEnabled={isHomeSessionConfigured(process.env.HOME_SESSION_SECRET)}
      smokeFixture={smokeFixture}
      renderSeed={renderSeed}
    >
      {children}
    </AccountRouteProvider>
  );

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={appearanceThemeColors.light} />
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body className="min-h-full">
        <AppearanceSync />
        <HomeQueryClientProvider>{accountProvider}</HomeQueryClientProvider>
        <HomeSpeedInsights />
        <AgentationOverlay disabled={smokeFixture} />
      </body>
    </html>
  );
}
