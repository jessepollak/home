import { parseAddress, type Address } from "@/shared/chain/hex";
import { OPERATOR_FEE_SETTINGS_DEFAULTS, parseOperatorFeeSettings } from "@/shared/fees/contract";
import { BRAND_DEFAULTS, BRAND_SETTINGS_DOMAIN, OPERATOR_BRANDING_SCHEMA_VERSION, parseBrandSettings } from "@/shared/operator-branding/contract";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseSettingsResponse } from "./envelope";
import { INVEST_SETTINGS_DEFAULTS, parseInvestSettings, parseInvestSettingsWrite } from "./invest";
import { parseRegionSettings, parseRegionSettingsWrite, REGION_SETTINGS_DEFAULTS } from "./regions";
import { deploymentProductSettings, parseProductSettings, productSettingsMatchCatalog, type ProductSettings } from "./products";

export { OPERATOR_SETTINGS_CONTRACT_VERSION } from "./envelope";
/** @public parses settings responses for future administrator clients */
export { parseSettingsResponse } from "./envelope";

export type DomainDefinition<T> = {
  schemaVersion: number;
  defaults: T;
  parse(value: unknown): T | null;
  parseWrite?: (value: unknown) => T | null;
  upgrade?: (fromVersion: number, value: unknown) => unknown;
  acceptsWrite?(value: T): boolean;
};

export type DomainRegistry = Record<string, DomainDefinition<unknown>>;

export type SupportSettings = { email: string | null; url: string | null };

export function parseSupportSettings(value: unknown): SupportSettings | null {
  if (!isObject(value) || !exactKeys(value, ["email", "url"])) return null;
  const { email, url } = value;
  if (email !== null && (typeof email !== "string" || email.length > 254 || email !== email.trim() || /\s/.test(email) || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))) return null;
  if (url !== null) {
    if (typeof url !== "string" || url.length > 2048) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    } catch {
      return null;
    }
  }
  return { email: email as string | null, url: url as string | null };
}
export const SUPPORT_ASSISTANT_DEFAULTS: SupportAssistantSettings = { mode: "operator", model: "", instructions: "" };

export type SupportAssistantSettings = { mode: "operator" | "assistant" | "hybrid"; model: string; instructions: string };

export function parseSupportAssistantSettings(value: unknown): SupportAssistantSettings | null {
  if (!isObject(value) || !exactKeys(value, ["mode", "model", "instructions"])) return null;
  if (value.mode !== "operator" && value.mode !== "assistant" && value.mode !== "hybrid") return null;
  if (typeof value.model !== "string" || value.model.length > 100 || (value.model !== "" && !/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.\-]*$/.test(value.model)) || (value.mode !== "operator" && !value.model)) return null;
  if (typeof value.instructions !== "string" || value.instructions.length > 2000 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value.instructions)) return null;
  return { mode: value.mode, model: value.model, instructions: value.instructions };
}


export type FundingCorridorSetting = { providerId: string; region: string; direction: "onramp" | "offramp"; offered: boolean };
export type FundingSettings = { corridors: FundingCorridorSetting[] };

export const FUNDING_SETTINGS_MAX_CORRIDORS = 500;
export const FUNDING_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function parseFundingSettings(value: unknown): FundingSettings | null {
  if (!isObject(value) || !exactKeys(value, ["corridors"]) || !Array.isArray(value.corridors) || value.corridors.length > FUNDING_SETTINGS_MAX_CORRIDORS) return null;
  const seen = new Set<string>();
  const corridors: FundingCorridorSetting[] = [];
  for (const entry of value.corridors) {
    if (!isObject(entry) || !exactKeys(entry, ["providerId", "region", "direction", "offered"])) return null;
    const { providerId, region, direction, offered } = entry;
    if (typeof providerId !== "string" || !FUNDING_PROVIDER_ID_PATTERN.test(providerId)) return null;
    if (typeof region !== "string" || !/^[A-Z]{2}$/.test(region)) return null;
    if (direction !== "onramp" && direction !== "offramp") return null;
    if (typeof offered !== "boolean") return null;
    const key = `${providerId}:${region}:${direction}`;
    if (seen.has(key)) return null;
    seen.add(key);
    corridors.push({ providerId, region, direction, offered });
  }
  return { corridors };
}

export const OPERATOR_SETTINGS_DOMAINS = {
  funding: { schemaVersion: 1, defaults: { corridors: [] }, parse: parseFundingSettings },
  support: { schemaVersion: 1, defaults: { email: null, url: null }, parse: parseSupportSettings },
  "support-assistant": { schemaVersion: 1, defaults: SUPPORT_ASSISTANT_DEFAULTS, parse: parseSupportAssistantSettings },
  [BRAND_SETTINGS_DOMAIN]: { schemaVersion: OPERATOR_BRANDING_SCHEMA_VERSION, defaults: BRAND_DEFAULTS, parse: parseBrandSettings },
  regions: { schemaVersion: 1, defaults: REGION_SETTINGS_DEFAULTS, parse: parseRegionSettings, parseWrite: parseRegionSettingsWrite },
  invest: { schemaVersion: 1, defaults: INVEST_SETTINGS_DEFAULTS, parse: parseInvestSettings, parseWrite: parseInvestSettingsWrite },
  fees: { schemaVersion: 1, defaults: OPERATOR_FEE_SETTINGS_DEFAULTS, parse: parseOperatorFeeSettings },
  products: { schemaVersion: 1, defaults: deploymentProductSettings(), parse: parseProductSettings, acceptsWrite: (value) => productSettingsMatchCatalog(value) } satisfies DomainDefinition<ProductSettings>,
} satisfies DomainRegistry;

export type SettingsEntry<T = unknown> = {
  domain: string;
  settings: { value: T; revision: number; source: "default" | "stored"; updatedAt: string | null; updatedBy: string | null };
};
export type SettingsResponse = SettingsEntry & { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION };
export type AllSettingsResponse = { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION; domains: SettingsEntry[] };
export type PutSettingsRequest = { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION; expectedRevision: number; value: unknown; operator: `0x${string}` };
export type ParsedPutSettingsRequest = Omit<PutSettingsRequest, "operator"> & { operator: Address };
export type AuditEntry = {
  id: string; occurredAt: string; actor: `0x${string}`;
} & (
  | { action: "settings.update"; target: { kind: "settings"; id: string }; before: unknown; after: unknown }
  | { action: "support.credential.update"; target: { kind: "settings"; id: string }; before: unknown; after: unknown }
  | { action: "support.credential.delete"; target: { kind: "settings"; id: string }; before: unknown; after: unknown }
  | { action: "customer.read"; target: { kind: "customer"; id: string }; purpose: string }
);
export type AuditListResponse = { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION; entries: AuditEntry[]; nextCursor: string | null };
export type ParsedAuditEntry = AuditEntry & { actor: Address };
export type ParsedAuditListResponse = Omit<AuditListResponse, "entries"> & { entries: ParsedAuditEntry[] };
export type OperatorSettingsErrorCode = "UNAUTHENTICATED" | "OPERATOR_FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "SETTINGS_CONFLICT" | "OPERATOR_CHANGED" | "CROSS_ORIGIN" | "SETTINGS_UNAVAILABLE";
export type OperatorSettingsErrorResponse = { error: { code: OperatorSettingsErrorCode }; current?: SettingsResponse };

export function parsePutSettingsRequest(value: unknown): ParsedPutSettingsRequest | null {
  if (!isObject(value) || !exactKeys(value, ["version", "expectedRevision", "value", "operator"])) return null;
  if (value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) return null;
  const operator = parseAddress(value.operator);
  if (!operator) return null;
  return { version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: value.expectedRevision as number, value: value.value, operator };
}

/** @public parses settings list responses for future administrator clients */
export function parseAllSettingsResponse(value: unknown): AllSettingsResponse | null {
  if (!isObject(value) || value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || !Array.isArray(value.domains)) return null;
  const domains = value.domains.map((entry) => parseSettingsResponse({ ...entry, version: OPERATOR_SETTINGS_CONTRACT_VERSION }));
  return domains.every((entry): entry is SettingsResponse => entry !== null)
    ? { version: OPERATOR_SETTINGS_CONTRACT_VERSION, domains: domains.map(({ domain, settings }) => ({ domain, settings })) } : null;
}

/** @public parses administrator audit responses for future clients */
export function parseAuditListResponse(value: unknown): ParsedAuditListResponse | null {
  if (!isObject(value) || value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || !Array.isArray(value.entries) || !(value.nextCursor === null || validCursor(value.nextCursor))) return null;
  const entries: ParsedAuditEntry[] = [];
  for (const entry of value.entries) {
    if (!isObject(entry)) return null;
    const actor = parseAddress(entry.actor);
    if (!actor || !validCursor(entry.id) || typeof entry.occurredAt !== "string" || !Number.isFinite(Date.parse(entry.occurredAt)) || !isObject(entry.target) || typeof entry.target.id !== "string") return null;
    if (entry.action === "settings.update" || entry.action === "support.credential.update" || entry.action === "support.credential.delete") {
      if (entry.target.kind !== "settings" || !("before" in entry) || !("after" in entry)) return null;
    } else if (entry.action === "customer.read") {
      if (entry.target.kind !== "customer" || typeof entry.purpose !== "string") return null;
    } else return null;
    entries.push({ ...entry, actor } as ParsedAuditEntry);
  }
  return { version: OPERATOR_SETTINGS_CONTRACT_VERSION, entries, nextCursor: value.nextCursor };
}

/** @public parses administrator settings errors for future clients */
export function parseOperatorSettingsErrorResponse(value: unknown): OperatorSettingsErrorResponse | null {
  if (!isObject(value) || !isObject(value.error)) return null;
  const code = value.error.code;
  if (code !== "UNAUTHENTICATED" && code !== "OPERATOR_FORBIDDEN" && code !== "NOT_FOUND" && code !== "INVALID_REQUEST" && code !== "SETTINGS_CONFLICT" && code !== "OPERATOR_CHANGED" && code !== "CROSS_ORIGIN" && code !== "SETTINGS_UNAVAILABLE") return null;
  return { error: { code }, ...(value.current ? { current: parseSettingsResponse(value.current) ?? undefined } : {}) };
}

export function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && (value.length < 19 || (value.length === 19 && value <= "9223372036854775807"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
