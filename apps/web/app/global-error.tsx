"use client";

import { brand } from "@/config/brand";
import { AppearanceSync } from "@/client/appearance/use-appearance";
import { AppErrorFallback } from "@/client/home/app-error";
import { appearanceBootScript } from "@/client/appearance/boot-script";
import { appearanceThemeColors } from "@/shared/appearance/preference";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={appearanceThemeColors.light} />
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body className="min-h-full">
        <title>{brand.name}</title>
        <AppearanceSync />
        <AppErrorFallback error={error} retry={retry} />
      </body>
    </html>
  );
}
