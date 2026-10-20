import type { PutSettingsRequest, SettingsEntry, SettingsResponse } from "@/shared/operator-settings/contract";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseSettingsResponse } from "@/shared/operator-settings/envelope";
import { BRAND_SETTINGS_DOMAIN, parseBrandSettings, type BrandSettings } from "./schema";

export { OPERATOR_BRANDING_SCHEMA_VERSION, BRAND_SETTINGS_DOMAIN, BRAND_DEFAULTS, parseBrandSettings, deriveBrandTokens, type BrandSettings } from "./schema";

export type BrandSettingsResponse = Omit<SettingsResponse, "domain" | "settings"> & { domain: typeof BRAND_SETTINGS_DOMAIN; settings: SettingsEntry<BrandSettings>["settings"] };

export function parseBrandSettingsResponse(value: unknown): BrandSettingsResponse | null {
  const response = parseSettingsResponse(value);
  if (response?.domain !== BRAND_SETTINGS_DOMAIN) return null;
  const brandSettings = parseBrandSettings(response.settings.value);
  return brandSettings === null ? null : { ...response, domain: BRAND_SETTINGS_DOMAIN, settings: { ...response.settings, value: brandSettings } };
}

export function brandSettingsPutRequest(expectedRevision: number, value: BrandSettings, operator: `0x${string}`): PutSettingsRequest {
  return { version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision, value, operator };
}
