import { BRAND_DEFAULTS, BRAND_FOREGROUND_MIN_CONTRAST, contrastRatio, deriveBrandTokens, type BrandSettings } from "./schema";

const LIGHT_PAGE = "#ffffff";
const LIGHT_MUTED_TEXT = "#737373";
const LIGHT_MUTED_SURFACE = "#f5f5f5";
const hexPattern = /^#[0-9a-f]{6}$/;

export const BRAND_COPY_FALLBACK_NAME = "Home";

export type BrandTheme = {
  primary: { color: string; foreground: string } | null;
  page: { color: string; foreground: string } | null;
  pageClamped: boolean;
  primaryClamped: boolean;
  appliedBackground: string;
  appliedPrimary: string;
};

function toHex(channels: readonly number[]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function mixToward(color: string, target: number, percent: number): string {
  return toHex([1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(channel + (target - channel) * (percent / 100));
  }));
}

export function boundLightBackground(color: string): { color: string; clamped: boolean } {
  for (let percent = 0; percent <= 100; percent += 1) {
    const candidate = mixToward(color, 255, percent);
    if (contrastRatio(candidate, LIGHT_MUTED_TEXT) >= BRAND_FOREGROUND_MIN_CONTRAST) return { color: candidate, clamped: percent > 0 };
  }
  return { color: LIGHT_PAGE, clamped: true };
}

export function boundReadablePrimary(color: string, background: string): { color: string; clamped: boolean } {
  for (let percent = 0; percent <= 100; percent += 1) {
    const candidate = mixToward(color, 0, percent);
    if (contrastRatio(candidate, background) >= BRAND_FOREGROUND_MIN_CONTRAST && contrastRatio(candidate, LIGHT_MUTED_SURFACE) >= BRAND_FOREGROUND_MIN_CONTRAST) return { color: candidate, clamped: percent > 0 };
  }
  return { color: "#000000", clamped: true };
}

export function deriveBrandTheme(settings: BrandSettings): BrandTheme {
  const bounded = boundLightBackground(settings.backgroundColor);
  const primary = boundReadablePrimary(settings.primaryColor, bounded.color);
  const tokens = deriveBrandTokens({ ...settings, primaryColor: primary.color });
  const customPrimary = primary.color !== BRAND_DEFAULTS.primaryColor;
  const customPage = bounded.color !== LIGHT_PAGE;
  return {
    primary: customPrimary ? { color: primary.color, foreground: tokens.primaryForeground } : null,
    page: customPage ? { color: bounded.color, foreground: "#000000" } : null,
    pageClamped: bounded.clamped,
    primaryClamped: primary.clamped,
    appliedBackground: bounded.color,
    appliedPrimary: primary.color,
  };
}

export function brandThemeCss(settings: BrandSettings): string | null {
  const theme = deriveBrandTheme(settings);
  const declarations: string[] = [];
  if (theme.primary) declarations.push(`--primary:${theme.primary.color}`, `--primary-foreground:${theme.primary.foreground}`, `--ring:${theme.primary.color}`);
  if (theme.page) declarations.push(`--background:${theme.page.color}`, `--foreground:${theme.page.foreground}`);
  if (declarations.length === 0) return null;
  if (!declarations.every((declaration) => hexPattern.test(declaration.slice(declaration.indexOf(":") + 1)))) return null;
  return `:root:not(.dark){${declarations.join(";")}}`;
}

export function brandCopyName(displayName: string): string {
  return displayName === BRAND_DEFAULTS.displayName ? BRAND_COPY_FALLBACK_NAME : displayName;
}
