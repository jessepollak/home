import type { SettingsEntry, SettingsResponse } from "./contract";

export const OPERATOR_SETTINGS_CONTRACT_VERSION = 1 as const;

/** @public parses settings responses for future administrator clients */
export function parseSettingsResponse(value: unknown): SettingsResponse | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || typeof response.domain !== "string" || !isSettings(response.settings)) return null;
  return value as SettingsResponse;
}

function isSettings(value: unknown): value is SettingsEntry["settings"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return "value" in settings && Number.isSafeInteger(settings.revision) && (settings.revision as number) >= 0 && (settings.source === "default" || settings.source === "stored") && (settings.updatedAt === null || typeof settings.updatedAt === "string") && (settings.updatedBy === null || typeof settings.updatedBy === "string");
}
