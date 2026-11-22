import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home · Run your own neobank on Base",
  description:
    "Home is open-source software for running a branded neobank on Base. You bring the customers and the brand; Home supplies the app, the provider integrations and the admin console.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
