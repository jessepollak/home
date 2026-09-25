export const OPERATOR_SETTINGS_CONTRACT_VERSION = 1 as const;

export type DomainDefinition<T> = {
  schemaVersion: number;
  defaults: T;
  parse(value: unknown): T | null;
  upgrade?: (fromVersion: number, value: unknown) => unknown;
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

export const OPERATOR_SETTINGS_DOMAINS = {
  support: { schemaVersion: 1, defaults: { email: null, url: null }, parse: parseSupportSettings },
} satisfies DomainRegistry;

export type SettingsEntry<T = unknown> = {
  domain: string;
  settings: { value: T; revision: number; source: "default" | "stored"; updatedAt: string | null; updatedBy: string | null };
};
export type SettingsResponse = SettingsEntry & { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION };
export type AllSettingsResponse = { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION; domains: SettingsEntry[] };
export type PutSettingsRequest = { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION; expectedRevision: number; value: unknown };
export type AuditEntry = {
  id: string; occurredAt: string; actor: `0x${string}`;
} & (
  | { action: "settings.update"; target: { kind: "settings"; id: string }; before: unknown; after: unknown }
  | { action: "customer.read"; target: { kind: "customer"; id: string }; purpose: string }
);
export type AuditListResponse = { version: typeof OPERATOR_SETTINGS_CONTRACT_VERSION; entries: AuditEntry[]; nextCursor: string | null };
export type OperatorSettingsErrorCode = "UNAUTHENTICATED" | "OPERATOR_FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "SETTINGS_CONFLICT" | "CROSS_ORIGIN" | "SETTINGS_UNAVAILABLE";
export type OperatorSettingsErrorResponse = { error: { code: OperatorSettingsErrorCode }; current?: SettingsResponse };

export function parsePutSettingsRequest(value: unknown): PutSettingsRequest | null {
  if (!isObject(value) || !exactKeys(value, ["version", "expectedRevision", "value"])) return null;
  if (value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) return null;
  return { version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: value.expectedRevision as number, value: value.value };
}

/** @public parses settings responses for future administrator clients */
export function parseSettingsResponse(value: unknown): SettingsResponse | null {
  if (!isObject(value) || value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || typeof value.domain !== "string" || !isSettings(value.settings)) return null;
  return value as SettingsResponse;
}

/** @public parses settings list responses for future administrator clients */
export function parseAllSettingsResponse(value: unknown): AllSettingsResponse | null {
  if (!isObject(value) || value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || !Array.isArray(value.domains)) return null;
  const domains = value.domains.map((entry) => parseSettingsResponse({ ...entry, version: OPERATOR_SETTINGS_CONTRACT_VERSION }));
  return domains.every((entry): entry is SettingsResponse => entry !== null)
    ? { version: OPERATOR_SETTINGS_CONTRACT_VERSION, domains: domains.map(({ domain, settings }) => ({ domain, settings })) } : null;
}

/** @public parses administrator audit responses for future clients */
export function parseAuditListResponse(value: unknown): AuditListResponse | null {
  if (!isObject(value) || value.version !== OPERATOR_SETTINGS_CONTRACT_VERSION || !Array.isArray(value.entries) || !(value.nextCursor === null || validCursor(value.nextCursor))) return null;
  for (const entry of value.entries) {
    if (!isObject(entry) || !validCursor(entry.id) || typeof entry.occurredAt !== "string" || !Number.isFinite(Date.parse(entry.occurredAt)) || !isAddress(entry.actor) || !isObject(entry.target) || typeof entry.target.id !== "string") return null;
    if (entry.action === "settings.update") {
      if (entry.target.kind !== "settings" || !("before" in entry) || !("after" in entry)) return null;
    } else if (entry.action === "customer.read") {
      if (entry.target.kind !== "customer" || typeof entry.purpose !== "string") return null;
    } else return null;
  }
  return value as AuditListResponse;
}

/** @public parses administrator settings errors for future clients */
export function parseOperatorSettingsErrorResponse(value: unknown): OperatorSettingsErrorResponse | null {
  if (!isObject(value) || !isObject(value.error)) return null;
  const code = value.error.code;
  if (code !== "UNAUTHENTICATED" && code !== "OPERATOR_FORBIDDEN" && code !== "NOT_FOUND" && code !== "INVALID_REQUEST" && code !== "SETTINGS_CONFLICT" && code !== "CROSS_ORIGIN" && code !== "SETTINGS_UNAVAILABLE") return null;
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
function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);
}
function isSettings(value: unknown): value is SettingsEntry["settings"] {
  return isObject(value) && "value" in value && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && (value.source === "default" || value.source === "stored") && (value.updatedAt === null || typeof value.updatedAt === "string") && (value.updatedBy === null || typeof value.updatedBy === "string");
}
