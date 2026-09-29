import { brand } from "@/config/brand";

export const OPERATOR_BRANDING_SCHEMA_VERSION = 1 as const;
export const BRAND_SETTINGS_DOMAIN = "brand" as const;

export type BrandSettings = {
  displayName: string;
  description: string;
  primaryColor: string;
  backgroundColor: string;
};

export const BRAND_DEFAULTS: BrandSettings = {
  displayName: brand.name,
  description: brand.description,
  primaryColor: brand.primaryColor,
  backgroundColor: brand.backgroundColor,
};

const colorPattern = /^#[0-9a-f]{6}$/;
const forbiddenText = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function parseBrandSettings(value: unknown): BrandSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 4 || !["displayName", "description", "primaryColor", "backgroundColor"].every((key) => Object.hasOwn(input, key))) return null;
  const { displayName, description, primaryColor, backgroundColor } = input;
  if (typeof displayName !== "string" || [...displayName].length < 1 || [...displayName].length > 40 || displayName !== displayName.trim() || forbiddenText.test(displayName)) return null;
  if (typeof description !== "string" || [...description].length < 1 || [...description].length > 160 || description !== description.trim() || forbiddenText.test(description)) return null;
  if (typeof primaryColor !== "string" || !colorPattern.test(primaryColor) || typeof backgroundColor !== "string" || !colorPattern.test(backgroundColor)) return null;
  return { displayName, description, primaryColor, backgroundColor };
}

/** @public contrast calculation used by the brand application follow-up */
export const BRAND_FOREGROUND_MIN_CONTRAST = 4.5;

function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

/** @public contrast calculation used by the brand application follow-up */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** @public foreground tokens used by the brand application follow-up */
export function deriveBrandTokens(settings: BrandSettings): { primaryForeground: "#000000" | "#ffffff"; backgroundForeground: "#000000" | "#ffffff" } {
  return {
    primaryForeground: contrastRatio(settings.primaryColor, "#ffffff") >= BRAND_FOREGROUND_MIN_CONTRAST ? "#ffffff" : "#000000",
    backgroundForeground: contrastRatio(settings.backgroundColor, "#ffffff") >= BRAND_FOREGROUND_MIN_CONTRAST ? "#ffffff" : "#000000",
  };
}
