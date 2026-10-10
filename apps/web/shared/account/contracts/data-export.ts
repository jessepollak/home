export const ACCOUNT_EXPORT_VERSION = 1 as const;
export const ACCOUNT_EXPORT_SCHEMA = "home.account-export" as const;
export const ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS = 50_000;

export const ACCOUNT_EXPORT_HOME_CLASSES = [
  "customer",
  "credentials",
  "wallets",
  "preferences",
  "invites",
  "email_requests",
  "operator_events",
  "access_audit",
  "actions",
  "cashout_orders",
  "operator_fees",
  "funding_orders",
  "funding_provider_customers",
  "funding_provider_credentials",
  "balance_snapshots",
  "balance_history_addresses",
  "balance_changes",
  "balance_checkpoints",
  "card_accounts",
  "cards",
  "card_events",
  "card_transactions",
  "support_conversations",
  "support_messages",
  "support_assistant_runs",
  "support_context_refs",
] as const;
export const ACCOUNT_EXPORT_DEVICE_CLASSES = ["device_preferences", "device_caches"] as const;

export type AccountExportHomeClass = (typeof ACCOUNT_EXPORT_HOME_CLASSES)[number];
export type AccountExportDeviceClass = (typeof ACCOUNT_EXPORT_DEVICE_CLASSES)[number];
export type AccountExportClassName = AccountExportHomeClass | AccountExportDeviceClass;

export type AccountExportValue =
  | string
  | number
  | boolean
  | null
  | readonly AccountExportValue[]
  | { readonly [key: string]: AccountExportValue };
export type AccountExportRecord = { readonly [key: string]: AccountExportValue };

export type AccountExportClass<Name extends AccountExportClassName = AccountExportClassName> = {
  name: Name;
  holder: Name extends AccountExportDeviceClass ? "current-device" : "home";
  records: AccountExportRecord[];
};

export type AccountExportBoundaries = {
  providerHeld: string;
  publicChain: string;
  currentDevice: string;
};

export type AccountExportResponse = {
  version: typeof ACCOUNT_EXPORT_VERSION;
  schema: typeof ACCOUNT_EXPORT_SCHEMA;
  generatedAt: string;
  complete: true;
  classes: AccountExportClass<AccountExportHomeClass>[];
  boundaries: AccountExportBoundaries;
};

export type AccountExportFile = Omit<AccountExportResponse, "classes"> & {
  classes: AccountExportClass[];
};

export const ACCOUNT_EXPORT_ERROR_CODES = [
  "ACCOUNT_EXPORT_UNAVAILABLE",
  "ACCOUNT_EXPORT_LINKAGE",
  "ACCOUNT_EXPORT_TOO_LARGE",
] as const;
export type AccountExportErrorCode = (typeof ACCOUNT_EXPORT_ERROR_CODES)[number];
export type AccountExportErrorResponse = { error: { code: AccountExportErrorCode; message: string } };

export function parseAccountExportErrorResponse(value: unknown): AccountExportErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code, message } = value.error;
  return isAccountExportErrorCode(code) && typeof message === "string" ? { error: { code, message } } : null;
}

function isAccountExportErrorCode(value: unknown): value is AccountExportErrorCode {
  return ACCOUNT_EXPORT_ERROR_CODES.some((code) => code === value);
}

export function parseAccountExportResponse(value: unknown): AccountExportResponse | null {
  if (!isRecord(value) || !hasOnly(value, ["version", "schema", "generatedAt", "complete", "classes", "boundaries"])) return null;
  if (value.version !== ACCOUNT_EXPORT_VERSION || value.schema !== ACCOUNT_EXPORT_SCHEMA || value.complete !== true) return null;
  if (!isIsoTimestamp(value.generatedAt)) return null;
  const boundaries = parseBoundaries(value.boundaries);
  if (!boundaries || !Array.isArray(value.classes) || value.classes.length !== ACCOUNT_EXPORT_HOME_CLASSES.length) return null;
  const classes: AccountExportClass<AccountExportHomeClass>[] = [];
  for (const [index, name] of ACCOUNT_EXPORT_HOME_CLASSES.entries()) {
    const entry: unknown = value.classes[index];
    if (!isRecord(entry) || !hasOnly(entry, ["name", "holder", "records"]) || entry.name !== name || entry.holder !== "home") return null;
    if (!Array.isArray(entry.records) || entry.records.length > ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS) return null;
    const records: AccountExportRecord[] = [];
    for (const record of entry.records) {
      if (!isExportRecord(record)) return null;
      records.push(record);
    }
    classes.push({ name, holder: "home", records });
  }
  return { version: ACCOUNT_EXPORT_VERSION, schema: ACCOUNT_EXPORT_SCHEMA, generatedAt: value.generatedAt, complete: true, classes, boundaries };
}

function parseBoundaries(value: unknown): AccountExportBoundaries | null {
  if (!isRecord(value) || !hasOnly(value, ["providerHeld", "publicChain", "currentDevice"])) return null;
  const { providerHeld, publicChain, currentDevice } = value;
  return typeof providerHeld === "string" && typeof publicChain === "string" && typeof currentDevice === "string"
    ? { providerHeld, publicChain, currentDevice } : null;
}

function isExportValue(value: unknown, depth: number): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every((item) => isExportValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isExportValue(item, depth + 1));
}

function isExportRecord(value: unknown): value is AccountExportRecord {
  return isRecord(value) && isExportValue(value, 0);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).every((key) => names.includes(key));
}
