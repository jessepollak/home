export type AppearancePreference = "light" | "dark" | "system";
export type ResolvedAppearance = "light" | "dark";

export const appearancePreferenceKey = "home.appearance.v1";
export const appearanceDarkClass = "dark";
export const appearanceThemeColors: Record<ResolvedAppearance, string> = {
  light: "#ffffff",
  dark: "#171717",
};

export function parseAppearancePreference(raw: unknown): AppearancePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  return preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
}
