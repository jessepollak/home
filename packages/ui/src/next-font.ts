import localFont from "next/font/local";

// Opt-in Next adapter. Never re-export from the framework-neutral barrel.
export const dmSans = localFont({
  src: [
    { path: "../fonts/dm-sans.woff2", weight: "100 1000", style: "normal" },
    { path: "../fonts/dm-sans-italic.woff2", weight: "100 1000", style: "italic" },
  ],
  variable: "--home-ui-font-dm-sans",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: "Arial",
});

// A numeric companion, not a claim that DM Sans implements OpenType tnum.
// Ship the unmodified upstream static 500 face; no synthetic variable range.
export const dmMono = localFont({
  src: [{ path: "../fonts/dm-mono-medium.ttf", weight: "500", style: "normal" }],
  variable: "--home-ui-font-dm-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "Courier New", "monospace"],
  // Next's Arial/Times metric fallbacks are proportional, so do not insert one.
  adjustFontFallback: false,
});
