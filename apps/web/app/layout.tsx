import type { Metadata } from "next";
import { brand } from "@/config/brand";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  const smokeFixture = process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL;
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={appearanceThemeColors.light} />
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body className="min-h-full">
        <AppearanceSync />
        <HomeQueryClientProvider>
          {children}
        </HomeQueryClientProvider>
        <HomeSpeedInsights />
        <AgentationOverlay disabled={smokeFixture} />
      </body>
    </html>
  );
}
