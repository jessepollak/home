import { OWNER_SESSION_RETENTION_MS } from "@/shared/account/session-types";

export const FINANCIAL_EVIDENCE_RETENTION_YEARS = 5 as const;

export const ACCOUNT_DELETION_REVOCATION_WINDOW_MS = OWNER_SESSION_RETENTION_MS;

export function financialEvidenceExpiresAt(anchor: Date): Date {
  const expires = new Date(anchor.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + FINANCIAL_EVIDENCE_RETENTION_YEARS);
  return expires;
}
