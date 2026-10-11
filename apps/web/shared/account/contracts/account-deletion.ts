import { ACCOUNT_EXPORT_HOME_CLASSES, type AccountExportHomeClass } from "@/shared/account/contracts/data-export";
import { FINANCIAL_EVIDENCE_RETENTION_YEARS } from "@/shared/account/financial-retention";

export const ACCOUNT_DELETION_VERSION = 1 as const;
export const ACCOUNT_DELETION_SCHEMA = "home.account-deletion" as const;
export const ACCOUNT_DELETED_ERROR_CODE = "ACCOUNT_DELETED" as const;

export const ACCOUNT_DELETION_STATUSES = ["queued", "completed"] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

export const ACCOUNT_DELETION_BLOCKER_CLASSES = ["actions", "cashout_orders", "funding_orders", "card_transactions"] as const;
export type AccountDeletionBlockerClass = (typeof ACCOUNT_DELETION_BLOCKER_CLASSES)[number];
export type AccountDeletionBlocker = { name: AccountDeletionBlockerClass; count: number };

export const ACCOUNT_DELETION_ATTEMPT_OUTCOMES = ["blocked", "failed"] as const;
export type AccountDeletionAttempt = { at: string; outcome: (typeof ACCOUNT_DELETION_ATTEMPT_OUTCOMES)[number] };

export type AccountDeletionStore =
  | { name: AccountExportHomeClass; disposition: "pending" }
  | { name: AccountExportHomeClass; disposition: "deleted" }
  | { name: AccountExportHomeClass; disposition: "retained-pseudonymized"; evidence: string; reason: string; expiresAt: string };

export type AccountDeletionProvider = {
  provider: string;
  records: string;
  disposition: "held-by-provider";
  statement: string;
};

export type AccountDeletionPublicChain = {
  disposition: "public-chain-immutable";
  statement: string;
};

export type AccountDeletionReceipt = {
  version: typeof ACCOUNT_DELETION_VERSION;
  schema: typeof ACCOUNT_DELETION_SCHEMA;
  requestId: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  retentionYears: typeof FINANCIAL_EVIDENCE_RETENTION_YEARS;
  blockers: AccountDeletionBlocker[];
  lastAttempt: AccountDeletionAttempt | null;
  stores: AccountDeletionStore[];
  providers: AccountDeletionProvider[];
  publicChain: AccountDeletionPublicChain;
};

export const ACCOUNT_DELETION_ERROR_CODES = [
  "ACCOUNT_DELETION_UNAVAILABLE",
  "ACCOUNT_DELETION_LINKAGE",
  "ACCOUNT_DELETION_NOT_FOUND",
  "INVALID_REQUEST",
] as const;
export type AccountDeletionErrorCode = (typeof ACCOUNT_DELETION_ERROR_CODES)[number];
export type AccountDeletionErrorResponse = { error: { code: AccountDeletionErrorCode; message: string } };

export function providerHeldStatement(provider: string): string {
  return `held by ${provider}, not deleted by Home`;
}

export function parseAccountDeletionErrorResponse(value: unknown): AccountDeletionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code: raw, message } = value.error;
  const code = ACCOUNT_DELETION_ERROR_CODES.find((entry) => entry === raw);
  return code && typeof message === "string" ? { error: { code, message } } : null;
}

export function parseAccountDeletionReceipt(value: unknown): AccountDeletionReceipt | null {
  if (!isRecord(value) || !hasOnly(value, [
    "version", "schema", "requestId", "status", "requestedAt", "updatedAt", "completedAt",
    "retentionYears", "blockers", "lastAttempt", "stores", "providers", "publicChain",
  ])) return null;
  if (value.version !== ACCOUNT_DELETION_VERSION || value.schema !== ACCOUNT_DELETION_SCHEMA) return null;
  if (value.retentionYears !== FINANCIAL_EVIDENCE_RETENTION_YEARS) return null;
  if (typeof value.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(value.requestId)) return null;
  const status = ACCOUNT_DELETION_STATUSES.find((entry) => entry === value.status);
  if (!status || !isIsoTimestamp(value.requestedAt) || !isIsoTimestamp(value.updatedAt)) return null;
  const completedAt = value.completedAt === null ? null : isIsoTimestamp(value.completedAt) ? value.completedAt : undefined;
  if (completedAt === undefined || (status === "completed") !== (completedAt !== null)) return null;

  if (!Array.isArray(value.blockers)) return null;
  const blockers: AccountDeletionBlocker[] = [];
  for (const entry of value.blockers) {
    if (!isRecord(entry) || !hasOnly(entry, ["name", "count"])) return null;
    const name = ACCOUNT_DELETION_BLOCKER_CLASSES.find((candidate) => candidate === entry.name);
    const count = entry.count;
    if (!name || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return null;
    blockers.push({ name, count });
  }
  if (status === "completed" && blockers.length > 0) return null;

  let lastAttempt: AccountDeletionAttempt | null = null;
  if (value.lastAttempt !== null) {
    const attempt = value.lastAttempt;
    if (!isRecord(attempt) || !hasOnly(attempt, ["at", "outcome"]) || !isIsoTimestamp(attempt.at)) return null;
    const outcome = ACCOUNT_DELETION_ATTEMPT_OUTCOMES.find((entry) => entry === attempt.outcome);
    if (!outcome) return null;
    lastAttempt = { at: attempt.at, outcome };
  }

  if (!Array.isArray(value.stores) || value.stores.length !== ACCOUNT_EXPORT_HOME_CLASSES.length) return null;
  const stores: AccountDeletionStore[] = [];
  for (const [index, name] of ACCOUNT_EXPORT_HOME_CLASSES.entries()) {
    const store = parseStore(value.stores[index], name, status);
    if (!store) return null;
    stores.push(store);
  }

  if (!Array.isArray(value.providers)) return null;
  const providers: AccountDeletionProvider[] = [];
  for (const entry of value.providers) {
    if (!isRecord(entry) || !hasOnly(entry, ["provider", "records", "disposition", "statement"])) return null;
    if (typeof entry.provider !== "string" || entry.provider.length === 0 || typeof entry.records !== "string") return null;
    if (entry.disposition !== "held-by-provider" || entry.statement !== providerHeldStatement(entry.provider)) return null;
    providers.push({ provider: entry.provider, records: entry.records, disposition: "held-by-provider", statement: entry.statement });
  }

  const chain = value.publicChain;
  if (!isRecord(chain) || !hasOnly(chain, ["disposition", "statement"])) return null;
  if (chain.disposition !== "public-chain-immutable" || typeof chain.statement !== "string" || chain.statement.length === 0) return null;

  return {
    version: ACCOUNT_DELETION_VERSION,
    schema: ACCOUNT_DELETION_SCHEMA,
    requestId: value.requestId,
    status,
    requestedAt: value.requestedAt,
    updatedAt: value.updatedAt,
    completedAt,
    retentionYears: FINANCIAL_EVIDENCE_RETENTION_YEARS,
    blockers,
    lastAttempt,
    stores,
    providers,
    publicChain: { disposition: "public-chain-immutable", statement: chain.statement },
  };
}

function parseStore(value: unknown, name: AccountExportHomeClass, status: AccountDeletionStatus): AccountDeletionStore | null {
  if (!isRecord(value) || value.name !== name) return null;
  if (status === "queued") {
    return hasOnly(value, ["name", "disposition"]) && value.disposition === "pending" ? { name, disposition: "pending" } : null;
  }
  if (value.disposition === "deleted") return hasOnly(value, ["name", "disposition"]) ? { name, disposition: "deleted" } : null;
  if (value.disposition !== "retained-pseudonymized" || !hasOnly(value, ["name", "disposition", "evidence", "reason", "expiresAt"])) return null;
  const { evidence, reason, expiresAt } = value;
  if (typeof evidence !== "string" || evidence.length === 0 || typeof reason !== "string" || reason.length === 0 || !isIsoTimestamp(expiresAt)) return null;
  return { name, disposition: "retained-pseudonymized", evidence, reason, expiresAt };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).every((key) => names.includes(key)) && names.every((key) => key in value);
}
