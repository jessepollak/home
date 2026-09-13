import localFont from "next/font/local";

export const dmSans = localFont({
  src: [{ path: "./dm-sans.woff2", weight: "100 1000", style: "normal" }],
  variable: "--home-ui-font-dm-sans",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: "Arial",
});

export const dmMono = localFont({
  src: [{ path: "./dm-mono-medium.woff2", weight: "500", style: "normal" }],
  variable: "--home-ui-font-dm-mono",
  display: "swap",
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Consolas",
    "Liberation Mono",
    "Courier New",
    "monospace",
  ],
  adjustFontFallback: false,
});
