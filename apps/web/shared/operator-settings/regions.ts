import * as z from "zod/mini";
import { countryRegionIds, type CountryCode } from "@/config/regions";

export const REGIONS_SETTINGS_DOMAIN = "regions" as const;

export type RegionSettings = z.output<typeof regionSettingsSchema>;

export const REGION_SETTINGS_DEFAULTS: RegionSettings = { offered: [...countryRegionIds], defaultRegion: "US" };

const catalog = new Set<string>(countryRegionIds);
const countrySchema = z.string().check(z.regex(/^[A-Z]{2}$/));
const shapeSchema = z.strictObject({
  offered: z.array(countrySchema).check(z.maxLength(300), z.refine((codes) => new Set(codes).size === codes.length)),
  defaultRegion: z.union([z.literal("GLOBAL"), countrySchema]),
}).check(z.refine((value) => value.defaultRegion === "GLOBAL" || !catalog.has(value.defaultRegion) || value.offered.includes(value.defaultRegion)));
const canonicalSchema = z.transform((value: z.output<typeof shapeSchema>) => ({
  offered: countryRegionIds.filter((code) => value.offered.includes(code)),
  defaultRegion: catalog.has(value.defaultRegion) ? value.defaultRegion as CountryCode : "GLOBAL" as const,
}));
const regionSettingsSchema = z.pipe(shapeSchema, canonicalSchema);
const regionSettingsWriteSchema = z.pipe(shapeSchema.check(
  z.refine((value) => value.offered.every((code) => catalog.has(code))),
  z.refine((value) => value.defaultRegion === "GLOBAL" || catalog.has(value.defaultRegion)),
), canonicalSchema);

export function parseRegionSettings(value: unknown): RegionSettings | null {
  const result = regionSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseRegionSettingsWrite(value: unknown): RegionSettings | null {
  const result = regionSettingsWriteSchema.safeParse(value);
  return result.success ? result.data : null;
}
