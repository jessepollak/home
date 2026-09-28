export const IDENTITY_VERIFICATION_VERSION = 1 as const;

export const identityVerificationStates = [
  "not-started",
  "in-progress",
  "pending",
  "manual-review",
  "verified",
  "retry",
  "rejected",
  "blocked",
  "duplicate-person",
  "reset",
  "removed",
  "level-changed",
  "temporarily-unavailable",
  "configuration-unavailable",
] as const;
export type IdentityVerificationState = (typeof identityVerificationStates)[number];

export const identityAvailabilityCategories = [
  "available",
  "verification-required",
  "verification-pending",
  "verification-rejected",
  "temporarily-unavailable",
  "configuration-unavailable",
] as const;
export type IdentityAvailabilityCategory = (typeof identityAvailabilityCategories)[number];

export const identityNextActions = ["start", "continue", "wait", "retry", "contact-support", "link-account", "none"] as const;
export type IdentityNextAction = (typeof identityNextActions)[number];

export const identityRetryReasons = [
  "photo-quality",
  "document-incomplete",
  "document-expired",
  "document-unsupported",
  "selfie",
  "proof-of-address",
  "proof-of-identity",
] as const;
export type IdentityRetryReason = (typeof identityRetryReasons)[number];

export type IdentityVerificationStatus = {
  state: IdentityVerificationState;
  category: IdentityAvailabilityCategory;
  action: IdentityNextAction;
  verifiedAt: string | null;
  retryReason: IdentityRetryReason | null;
  supportUrl: string | null;
  consentRequired: boolean;
};

export type IdentityVerificationStatusResponse = {
  version: typeof IDENTITY_VERIFICATION_VERSION;
  status: IdentityVerificationStatus;
};

export const IDENTITY_CONSENT_VERSION = "1";
export const IDENTITY_HOSTED_LINK_TTL_SECONDS = 1800;
export type IdentityVerificationSessionRequest = { consent?: true; locale?: string };

export type IdentityVerificationSessionResponse = {
  version: typeof IDENTITY_VERIFICATION_VERSION;
  token: string;
  status: IdentityVerificationStatus;
};

export type IdentityVerificationLinkResponse = {
  version: typeof IDENTITY_VERIFICATION_VERSION;
  url: string;
};
export const IDENTITY_RECONCILE_VERSION = 1 as const;
export const IDENTITY_RECONCILE_MAX_ROWS = 50;

export type IdentityReconcileResponse = {
  version: typeof IDENTITY_RECONCILE_VERSION;
  processed: number;
  failed: number;
};

export type IdentityVerificationErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_IDENTITY_REQUEST"
  | "CONSENT_REQUIRED"
  | "IDENTITY_STATE_CONFLICT"
  | "IDENTITY_RATE_LIMITED"
  | "IDENTITY_TEMPORARILY_UNAVAILABLE"
  | "IDENTITY_CONFIGURATION_UNAVAILABLE";

const MAX_TOKEN_LENGTH = 4_096;
const MAX_URL_LENGTH = 4_096;
const MAX_TIMESTAMP_LENGTH = 64;

export function isIdentityConsentLocale(value: unknown): value is string {
  return typeof value === "string" && value.length <= 35 && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);
}

export function parseIdentityVerificationSessionRequest(value: unknown): IdentityVerificationSessionRequest | null {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "consent" && key !== "locale")) return null;
  if ("consent" in value && value.consent !== true) return null;
  if ("locale" in value && !isIdentityConsentLocale(value.locale)) return null;
  return { ...(value.consent === true ? { consent: true as const } : {}), ...(typeof value.locale === "string" ? { locale: value.locale } : {}) };
}

export function readIdentityVerificationStatus(value: unknown): IdentityVerificationStatus | null {
  if (!isRecord(value) || value.version !== IDENTITY_VERIFICATION_VERSION) return null;
  return parseStatus(value.status);
}

export function readIdentityVerificationSession(value: unknown): { token: string; status: IdentityVerificationStatus } | null {
  if (!isRecord(value) || value.version !== IDENTITY_VERIFICATION_VERSION) return null;
  const status = parseStatus(value.status);
  if (!status || typeof value.token !== "string" || value.token.length === 0 || value.token.length > MAX_TOKEN_LENGTH) return null;
  return { token: value.token, status };
}

export function readIdentityVerificationLink(value: unknown): string | null {
  if (!isRecord(value) || value.version !== IDENTITY_VERIFICATION_VERSION) return null;
  return isHttpsUrl(value.url) ? value.url : null;
}
/** @public external scheduler response parser, exercised by the reconcile route contract test */
export function readIdentityReconcile(value: unknown): IdentityReconcileResponse | null {
  if (!isRecord(value) || value.version !== IDENTITY_RECONCILE_VERSION) return null;
  if (!isReconcileCount(value.processed) || !isReconcileCount(value.failed)) return null;
  if (value.failed > value.processed) return null;
  return { version: IDENTITY_RECONCILE_VERSION, processed: value.processed, failed: value.failed };
}

function isReconcileCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= IDENTITY_RECONCILE_MAX_ROWS;
}

function parseStatus(value: unknown): IdentityVerificationStatus | null {
  if (!isRecord(value)) return null;
  const { state, category, action, verifiedAt, retryReason, supportUrl, consentRequired } = value;
  if (!includes(identityVerificationStates, state)) return null;
  if (!includes(identityAvailabilityCategories, category)) return null;
  if (!includes(identityNextActions, action)) return null;
  if (verifiedAt !== null && (typeof verifiedAt !== "string" || verifiedAt.length > MAX_TIMESTAMP_LENGTH || Number.isNaN(Date.parse(verifiedAt)))) return null;
  if (retryReason !== null && !includes(identityRetryReasons, retryReason)) return null;
  if (retryReason !== null && state !== "retry") return null;
  if (verifiedAt !== null && state !== "verified") return null;
  if (supportUrl !== null && !isSupportUrl(supportUrl)) return null;
  if (typeof consentRequired !== "boolean") return null;
  return { state, category, action, verifiedAt, retryReason, supportUrl, consentRequired } as IdentityVerificationStatus;
}

export function isSupportUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "mailto:" && /^[^@\s,]+@[^@\s,]+$/.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function includes<T extends string>(values: ReadonlyArray<T>, value: unknown): value is T {
  return typeof value === "string" && (values as ReadonlyArray<string>).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
