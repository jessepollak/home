import * as z from "zod/mini";
import { parseAddress, type Address } from "@/shared/chain/hex";
import { OPERATOR_FEE_SETTINGS_DEFAULTS, parseOperatorFeeSettings } from "@/shared/fees/contract";
import { BRAND_DEFAULTS, BRAND_SETTINGS_DOMAIN, OPERATOR_BRANDING_SCHEMA_VERSION, parseBrandSettings } from "@/shared/operator-branding/contract";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseSettingsResponse, settingsEntrySchema } from "./envelope";
import { INVEST_SETTINGS_DEFAULTS, parseInvestSettings, parseInvestSettingsWrite } from "./invest";
import { parseRegionSettings, parseRegionSettingsWrite, REGION_SETTINGS_DEFAULTS } from "./regions";
import { deploymentProductSettings, parseProductSettings, productSettingsMatchCatalog, type ProductSettings } from "./products";

export { OPERATOR_SETTINGS_CONTRACT_VERSION, type SettingsEntry, type SettingsResponse } from "./envelope";
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

const supportSettingsSchema = z.strictObject({
  email: z.nullable(z.string().check(z.maxLength(254), z.refine((email) =>
    email === email.trim() && !/\s/.test(email) && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)))),
  url: z.nullable(z.string().check(z.maxLength(2048), z.refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }))),
});
export type SupportSettings = z.output<typeof supportSettingsSchema>;

export function parseSupportSettings(value: unknown): SupportSettings | null {
  const result = supportSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

const supportAssistantSettingsSchema = z.strictObject({
  mode: z.enum(["operator", "assistant", "hybrid"]),
  model: z.string().check(z.maxLength(100), z.refine((model) => model === "" || /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.\-]*$/.test(model))),
  instructions: z.string().check(z.maxLength(2000), z.refine((instructions) => !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(instructions))),
}).check(z.refine((settings) => settings.mode === "operator" || settings.model !== ""));
export type SupportAssistantSettings = z.output<typeof supportAssistantSettingsSchema>;
export const SUPPORT_ASSISTANT_DEFAULTS: SupportAssistantSettings = { mode: "operator", model: "", instructions: "" };

export function parseSupportAssistantSettings(value: unknown): SupportAssistantSettings | null {
  const result = supportAssistantSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const FUNDING_SETTINGS_MAX_CORRIDORS = 500;
export const FUNDING_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const fundingCorridorSettingSchema = z.strictObject({
  providerId: z.string().check(z.regex(FUNDING_PROVIDER_ID_PATTERN)),
  region: z.string().check(z.regex(/^[A-Z]{2}$/)),
  direction: z.enum(["onramp", "offramp"]),
  offered: z.boolean(),
});
const fundingSettingsSchema = z.strictObject({
  corridors: z.array(fundingCorridorSettingSchema).check(z.maxLength(FUNDING_SETTINGS_MAX_CORRIDORS),
    z.refine((corridors) => new Set(corridors.map((entry) => `${entry.providerId}:${entry.region}:${entry.direction}`)).size === corridors.length)),
});
export type FundingSettings = z.output<typeof fundingSettingsSchema>;

export function parseFundingSettings(value: unknown): FundingSettings | null {
  const result = fundingSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
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

const addressSchema = z.pipe(
  z.custom<`0x${string}`>((value) => parseAddress(value) !== null),
  z.transform((value): Address => parseAddress(value) as Address),
);
const putSettingsRequestSchema = z.strictObject({
  version: z.literal(OPERATOR_SETTINGS_CONTRACT_VERSION),
  expectedRevision: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0)),
  value: z.unknown(),
  operator: addressSchema,
}).check(z.refine((request) => Object.hasOwn(request, "value")));
const allSettingsResponseSchema = z.object({
  version: z.literal(OPERATOR_SETTINGS_CONTRACT_VERSION),
  domains: z.array(z.pipe(settingsEntrySchema, z.transform(({ domain, settings }) => ({ domain, settings })))),
});
const cursorSchema = z.string().check(z.regex(/^[1-9]\d*$/),
  z.refine((value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807")));
const auditFields = {
  id: cursorSchema,
  occurredAt: z.string().check(z.refine((value) => Number.isFinite(Date.parse(value)))),
  actor: addressSchema,
};
const settingsAuditEntrySchema = <Action extends "settings.update" | "support.credential.update" | "support.credential.delete">(action: Action) => z.looseObject({
  ...auditFields,
  action: z.literal(action),
  target: z.looseObject({ kind: z.literal("settings"), id: z.string() }),
  before: z.unknown(),
  after: z.unknown(),
}).check(z.refine((entry) => "before" in entry && "after" in entry));
const auditEntrySchema = z.union([
  settingsAuditEntrySchema("settings.update"),
  settingsAuditEntrySchema("support.credential.update"),
  settingsAuditEntrySchema("support.credential.delete"),
  z.looseObject({
    ...auditFields,
    action: z.literal("customer.read"),
    target: z.looseObject({ kind: z.literal("customer"), id: z.string() }),
    purpose: z.string(),
  }),
]);
const auditListResponseSchema = z.object({
  version: z.literal(OPERATOR_SETTINGS_CONTRACT_VERSION),
  entries: z.array(auditEntrySchema),
  nextCursor: z.nullable(cursorSchema),
});
const operatorSettingsErrorCodeSchema = z.enum([
  "UNAUTHENTICATED", "OPERATOR_FORBIDDEN", "NOT_FOUND", "INVALID_REQUEST",
  "SETTINGS_CONFLICT", "OPERATOR_CHANGED", "CROSS_ORIGIN", "SETTINGS_UNAVAILABLE",
]);
const operatorSettingsErrorResponseSchema = z.pipe(z.object({
  error: z.object({ code: operatorSettingsErrorCodeSchema }),
  current: z.optional(z.unknown()),
}), z.transform((value) => ({
  error: value.error,
  ...(value.current ? { current: parseSettingsResponse(value.current) ?? undefined } : {}),
})));

export type AllSettingsResponse = z.output<typeof allSettingsResponseSchema>;
export type PutSettingsRequest = z.input<typeof putSettingsRequestSchema>;
export type ParsedPutSettingsRequest = z.output<typeof putSettingsRequestSchema>;
export type AuditEntry = z.input<typeof auditEntrySchema>;
export type ParsedAuditListResponse = z.output<typeof auditListResponseSchema>;
export type OperatorSettingsErrorCode = z.output<typeof operatorSettingsErrorCodeSchema>;
export type OperatorSettingsErrorResponse = z.output<typeof operatorSettingsErrorResponseSchema>;

export function parsePutSettingsRequest(value: unknown): ParsedPutSettingsRequest | null {
  const result = putSettingsRequestSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** @public parses settings list responses for future administrator clients */
export function parseAllSettingsResponse(value: unknown): AllSettingsResponse | null {
  const result = allSettingsResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** @public parses administrator audit responses for future clients */
export function parseAuditListResponse(value: unknown): ParsedAuditListResponse | null {
  const result = auditListResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** @public parses administrator settings errors for future clients */
export function parseOperatorSettingsErrorResponse(value: unknown): OperatorSettingsErrorResponse | null {
  const result = operatorSettingsErrorResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function validCursor(value: unknown): value is string {
  return cursorSchema.safeParse(value).success;
}
