import type { Metadata } from "next";
import { dmMono, dmSans } from "@home/ui/next-font";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home UI foundation",
  description: "Isolated typography and control catalog for Home.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
