"use client";

import { brand } from "@/config/brand";
import { AppearanceSync } from "@/client/appearance/use-appearance";
import { AppErrorFallback } from "@/client/home/app-error";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <title>{brand.name}</title>
        <AppearanceSync />
        <AppErrorFallback error={error} retry={retry} />
      </body>
    </html>
  );
}
