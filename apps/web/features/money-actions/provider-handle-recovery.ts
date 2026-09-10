import {
  MoneyActionClientError,
  readMoneyAction,
  recordMoneyActionSubmission,
  type MoneyActionApiFetch,
} from "./client";
import {
  ProviderHandleJournal,
  sameProviderHandle,
  type ProviderHandleJournalEntry,
  type ProviderHandleJournalIssue,
} from "./provider-handle-journal";
import type { PreparedMoneyAction } from "./types";
import type { StoredMoneyActionOperation } from "@/server/money-actions/store";

export type ProviderHandleRecoveryResult = {
  kind: "none" | "acknowledged" | "retained" | "conflict" | "inconsistent";
  operation: StoredMoneyActionOperation;
  cleanupPending?: boolean;
  issues: ProviderHandleJournalIssue[];
};

export async function recoverJournaledProviderHandle(input: {
  fetchApi: MoneyActionApiFetch;
  journal: ProviderHandleJournal;
  action: PreparedMoneyAction;
  operation?: StoredMoneyActionOperation;
  assertActive: () => void;
}): Promise<ProviderHandleRecoveryResult> {
  const snapshot = input.journal.inspect();
  const ownerActionEntries = snapshot.entries.filter((entry) => sameOwnerAction(entry, input.action));
  const bindingConflict = ownerActionEntries.some((entry) => !entryMatches(entry, input.action));
  const entries = ownerActionEntries.filter((entry) => entryMatches(entry, input.action));
  let operation = input.operation ?? await readMoneyAction(input.fetchApi, input.action.id, input.action);
  input.assertActive();

  if (bindingConflict) {
    return {
      kind: "conflict",
      operation,
      issues: withIssue(snapshot.issues, "binding-conflict"),
    };
  }
  if (entries.length === 0) {
    return { kind: "none", operation, issues: snapshot.issues };
  }
  const handle = entries[0]!.handle;
  if (entries.some((entry) => !sameProviderHandle(entry.handle, handle))) {
    return { kind: "conflict", operation, issues: snapshot.issues };
  }
  if (isPreparedOperation(operation)) {
    return { kind: "inconsistent", operation, issues: snapshot.issues };
  }

  const durable = durableEvidenceState(operation, entries[0]!);
  if (durable === "exact") {
    return cleanupAcknowledgedEntries(input, entries, operation, snapshot.issues);
  }
  if (durable === "conflict") {
    return { kind: "conflict", operation, issues: snapshot.issues };
  }

  try {
    operation = await recordMoneyActionSubmission(
      input.fetchApi,
      input.action.id,
      referenceFor(entries[0]!),
      input.action,
    );
    input.assertActive();
  } catch (error) {
    if (errorStatus(error) !== 409) {
      return { kind: "retained", operation, issues: snapshot.issues };
    }
    try {
      operation = await readMoneyAction(input.fetchApi, input.action.id, input.action);
      input.assertActive();
    } catch {
      return { kind: "retained", operation, issues: snapshot.issues };
    }
  }

  if (isPreparedOperation(operation)) {
    return { kind: "inconsistent", operation, issues: snapshot.issues };
  }
  const recorded = durableEvidenceState(operation, entries[0]!);
  if (recorded === "exact") {
    return cleanupAcknowledgedEntries(input, entries, operation, snapshot.issues);
  }
  if (recorded === "conflict") {
    return { kind: "conflict", operation, issues: snapshot.issues };
  }
  return {
    kind: operation.status === "prepared" ? "inconsistent" : "retained",
    operation,
    issues: snapshot.issues,
  };
}

async function cleanupAcknowledgedEntries(
  input: {
    journal: ProviderHandleJournal;
    assertActive: () => void;
  },
  entries: ProviderHandleJournalEntry[],
  operation: StoredMoneyActionOperation,
  issues: ProviderHandleJournalIssue[],
): Promise<ProviderHandleRecoveryResult> {
  let cleanupPending = false;
  const cleanupIssues = [...issues];
  for (const entry of entries) {
    input.assertActive();
    const result = input.journal.acknowledge(entry);
    if (!result.acknowledged) cleanupPending = true;
    for (const issue of result.issues) {
      if (!cleanupIssues.includes(issue)) cleanupIssues.push(issue);
    }
  }
  return {
    kind: "acknowledged",
    operation,
    ...(cleanupPending ? { cleanupPending: true } : {}),
    issues: cleanupIssues,
  };
}

function isPreparedOperation(operation: StoredMoneyActionOperation): boolean {
  return operation.status === "prepared";
}

function durableEvidenceState(
  operation: StoredMoneyActionOperation,
  entry: ProviderHandleJournalEntry,
): "absent" | "exact" | "conflict" {
  if (entry.handle.kind === "submission-id") {
    if (operation.submissionId === undefined) return "absent";
    return operation.submissionId === entry.handle.value ? "exact" : "conflict";
  }
  if (operation.userOperationHash === undefined) return "absent";
  return operation.userOperationHash === entry.handle.value ? "exact" : "conflict";
}

function referenceFor(entry: ProviderHandleJournalEntry) {
  return entry.handle.kind === "submission-id"
    ? { submissionId: entry.handle.value }
    : { userOperationHash: entry.handle.value };
}

function sameOwnerAction(entry: ProviderHandleJournalEntry, action: PreparedMoneyAction): boolean {
  return entry.actionId === action.id &&
    entry.owner.subject === action.owner.subject &&
    entry.owner.address === action.owner.address &&
    entry.owner.chainId === action.owner.chainId;
}

function entryMatches(entry: ProviderHandleJournalEntry, action: PreparedMoneyAction): boolean {
  return sameOwnerAction(entry, action) &&
    entry.reviewHash === action.reviewHash &&
    entry.actionKind === action.kind &&
    entry.provider === action.owner.accountProvider &&
    entry.owner.accountProvider === action.owner.accountProvider;
}

function withIssue(
  issues: ProviderHandleJournalIssue[],
  issue: ProviderHandleJournalIssue,
): ProviderHandleJournalIssue[] {
  return issues.includes(issue) ? issues : [...issues, issue];
}

function errorStatus(error: unknown): number | null {
  if (error instanceof MoneyActionClientError) return null;
  return error && typeof error === "object" && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}
