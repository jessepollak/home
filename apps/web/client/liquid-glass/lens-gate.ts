export type NavLensEnvironment = {
  mobileLayout: boolean;
  reducedTransparency: boolean;
  forcedColors: boolean;
  backdropFilter: boolean;
};

export type EngineBrand = { brand: string };

export const navLensQueries = {
  mobileLayout: "(max-width: 63.9375rem)",
  reducedTransparency: "(prefers-reduced-transparency: reduce)",
  forcedColors: "(forced-colors: active)",
} as const;

export function shouldMountNavLens(environment: NavLensEnvironment): boolean {
  return environment.mobileLayout
    && environment.backdropFilter
    && !environment.reducedTransparency
    && !environment.forcedColors;
}

export function isChromiumEngine(brands: readonly EngineBrand[] | null | undefined): boolean {
  return Array.isArray(brands) && brands.some((entry) => entry?.brand === "Chromium");
}

export function shouldRefractNavRim(environment: NavLensEnvironment & { brands: readonly EngineBrand[] | null | undefined }): boolean {
  return shouldMountNavLens(environment) && isChromiumEngine(environment.brands);
}
