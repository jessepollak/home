import type { Metadata } from "next";
import { HomeQueryClientProvider } from "@/client/query/query-client";
import { HomeSpeedInsights } from "@/client/observability/home-speed-insights";
import { AgentationOverlay } from "@/client/observability/agentation-overlay";
import { AppearanceSync } from "@/client/appearance/use-appearance";
import { appearanceBootScript } from "@/client/appearance/boot-script";
import { appearanceThemeColors } from "@/shared/appearance/preference";
import { BrandNameProvider } from "@/client/brand/brand-name";
import { resolveBrand } from "@/server/operator-settings/brand";
import { brandCopyName, brandThemeCss } from "@/shared/operator-branding/theme";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await resolveBrand();
  return {
    title: `${settings.displayName} · local money preview`,
    description: settings.description,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { settings } = await resolveBrand();
  const themeCss = brandThemeCss(settings);
  const smokeFixture = process.env.HOME_PLAYWRIGHT_SMOKE === "1" && !process.env.VERCEL;
  return (
    <html lang="en" className="h-full antialiased scroll-pb-(--shell-navigation-clearance) lg:scroll-pb-4" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={appearanceThemeColors.light} />
        {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body className="min-h-full">
        <AppearanceSync />
        <BrandNameProvider name={brandCopyName(settings.displayName)}>
          <HomeQueryClientProvider>
            {children}
          </HomeQueryClientProvider>
        </BrandNameProvider>
        <HomeSpeedInsights />
        <AgentationOverlay disabled={smokeFixture} />
      </body>
    </html>
  );
}
