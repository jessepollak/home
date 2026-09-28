import { countryRegionIds, type CountryCode, type RegionId } from "@/config/regions";

export const REGIONS_SETTINGS_DOMAIN = "regions" as const;

export type RegionSettings = { offered: CountryCode[]; defaultRegion: RegionId };

export const REGION_SETTINGS_DEFAULTS: RegionSettings = { offered: [...countryRegionIds], defaultRegion: "US" };

const catalog = new Set<string>(countryRegionIds);
const COUNTRY_FORMAT = /^[A-Z]{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parse(value: unknown, strict: boolean): RegionSettings | null {
  if (!isObject(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "offered") || !Object.hasOwn(value, "defaultRegion")) return null;
  const { offered, defaultRegion } = value;
  if (!Array.isArray(offered) || offered.length > 300 || typeof defaultRegion !== "string") return null;
  const seen = new Set<string>();
  for (const code of offered) {
    if (typeof code !== "string" || !COUNTRY_FORMAT.test(code) || seen.has(code)) return null;
    if (strict && !catalog.has(code)) return null;
    seen.add(code);
  }
  const normalized = countryRegionIds.filter((code) => seen.has(code));
  if (defaultRegion === "GLOBAL") return { offered: normalized, defaultRegion };
  if (!COUNTRY_FORMAT.test(defaultRegion)) return null;
  if (!catalog.has(defaultRegion)) return strict ? null : { offered: normalized, defaultRegion: "GLOBAL" };
  if (!seen.has(defaultRegion)) return null;
  return { offered: normalized, defaultRegion: defaultRegion as CountryCode };
}

export function parseRegionSettings(value: unknown): RegionSettings | null {
  return parse(value, false);
}

export function parseRegionSettingsWrite(value: unknown): RegionSettings | null {
  return parse(value, true);
}
