import type { PutSettingsRequest, SettingsEntry, SettingsResponse } from "@/shared/operator-settings/contract";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseSettingsResponse } from "@/shared/operator-settings/envelope";
import { BRAND_SETTINGS_DOMAIN, parseBrandSettings, type BrandSettings } from "./schema";

/** @public brand settings contract consumed by the administrator UI follow-up */
export { OPERATOR_BRANDING_SCHEMA_VERSION, BRAND_SETTINGS_DOMAIN, BRAND_DEFAULTS, parseBrandSettings, BRAND_FOREGROUND_MIN_CONTRAST, contrastRatio, deriveBrandTokens, type BrandSettings } from "./schema";

export type BrandSettingsResponse = Omit<SettingsResponse, "domain" | "settings"> & { domain: typeof BRAND_SETTINGS_DOMAIN; settings: SettingsEntry<BrandSettings>["settings"] };

/** @public response parser consumed by the administrator UI follow-up */
export function parseBrandSettingsResponse(value: unknown): BrandSettingsResponse | null {
  const response = parseSettingsResponse(value);
  if (response?.domain !== BRAND_SETTINGS_DOMAIN) return null;
  const brandSettings = parseBrandSettings(response.settings.value);
  return brandSettings === null ? null : { ...response, domain: BRAND_SETTINGS_DOMAIN, settings: { ...response.settings, value: brandSettings } };
}

/** @public request builder consumed by the administrator UI follow-up */
export function brandSettingsPutRequest(expectedRevision: number, value: BrandSettings, operator: `0x${string}`): PutSettingsRequest {
  return { version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision, value, operator };
}
