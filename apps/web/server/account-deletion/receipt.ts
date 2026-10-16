import "server-only";

import { ACCOUNT_EXPORT_HOME_CLASSES, type AccountExportHomeClass } from "@/shared/account/contracts/data-export";
import { ACCOUNT_DELETION_SCHEMA, ACCOUNT_DELETION_VERSION, providerHeldStatement, type AccountDeletionBlocker, type AccountDeletionProvider, type AccountDeletionReceipt } from "@/shared/account/contracts/account-deletion";
import { FINANCIAL_EVIDENCE_RETENTION_YEARS, financialEvidenceExpiresAt } from "@/shared/account/financial-retention";

export type DeletionRequestRow = {
  id: string; customer_id: string | null; session_owner_keys?: string[] | null; status: "queued" | "completed";
  requested_at: Date; updated_at: Date; completed_at: Date | null;
  last_attempt_at: Date | null; last_attempt_outcome: "blocked" | "failed" | null;
  blockers: AccountDeletionBlocker[]; receipt: AccountDeletionReceipt | null;
};

const evidence: Partial<Record<AccountExportHomeClass, string>> = {
  actions: "Amounts, outcomes and immutable transaction receipt facts",
  cashout_orders: "Provider order identifiers, amounts, outcomes and reconciliation timestamps",
  operator_fees: "Operator fee amounts and collection evidence",
  funding_orders: "Provider order identifiers, amounts, quote fees and verified receipt facts",
  card_accounts: "Pseudonymous account mode and timestamps",
  cards: "Provider card identifiers and timestamps",
  card_transactions: "Provider transaction identifiers, amounts, outcomes and timestamps",
  access_audit: "Operator access accountability with an orphaned random customer identifier",
};

export function heldByProvider(provider: string, records: string): AccountDeletionProvider {
  return { provider, records, disposition: "held-by-provider", statement: providerHeldStatement(provider) };
}

export function deletionReceipt(row: DeletionRequestRow, providers: AccountDeletionProvider[] = [], completedAt?: Date): AccountDeletionReceipt {
  if (row.receipt) return row.receipt;
  const expiresAt = completedAt ? financialEvidenceExpiresAt(completedAt).toISOString() : null;
  return {
    version: ACCOUNT_DELETION_VERSION, schema: ACCOUNT_DELETION_SCHEMA, requestId: row.id,
    status: completedAt ? "completed" : "queued", requestedAt: row.requested_at.toISOString(),
    updatedAt: (completedAt ?? row.updated_at).toISOString(), completedAt: completedAt?.toISOString() ?? null,
    retentionYears: FINANCIAL_EVIDENCE_RETENTION_YEARS,
    blockers: completedAt ? [] : row.blockers,
    lastAttempt: row.last_attempt_at && row.last_attempt_outcome ? { at: row.last_attempt_at.toISOString(), outcome: row.last_attempt_outcome } : null,
    stores: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => {
      if (!expiresAt) return { name, disposition: "pending" };
      const retained = evidence[name];
      return retained ? { name, disposition: "retained-pseudonymized", evidence: retained,
        reason: name === "access_audit" ? "Operator access accountability" : "Minimum financial records for money correctness, reconciliation and duplicate-success protection", expiresAt }
        : { name, disposition: "deleted" };
    }),
    providers,
    publicChain: { disposition: "public-chain-immutable", statement: "Onchain history is public on Base. Home cannot erase it." },
  };
}
