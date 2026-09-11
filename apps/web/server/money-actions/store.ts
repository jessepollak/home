import type {
  MoneyActionOperationStatus,
  MoneyActionOwner,
  PreparedMoneyAction,
} from "@/features/money-actions/types";
import {
  canReleaseMoneyActionAdmission,
  canTransitionMoneyActionStatus,
} from "./status-transitions.js";

export { canReleaseMoneyActionAdmission } from "./status-transitions.js";

export type StoredMoneyActionOperation = {
  action: PreparedMoneyAction;
  status: MoneyActionOperationStatus;
  attemptCount: number;
  claimedAt?: string;
  abandonedAt?: string;
  submissionId?: string;
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};

export type MoneyActionClaim = {
  action: PreparedMoneyAction;
  operation: StoredMoneyActionOperation;
  disposition: "dispatch" | "recover";
};

export type MoneyActionIssueStoreOptions = {
  sensitiveAction: PreparedMoneyAction;
  sensitivePayloadExpiresAt: string;
};

export type MoneyActionListScope = "unresolved-send";

export interface MoneyActionStore {
  issue(action: PreparedMoneyAction, options?: MoneyActionIssueStoreOptions): Promise<"issued" | "existing">;
  claim(
    owner: MoneyActionOwner,
    id: string,
    reviewHash: string,
    now: string,
  ): Promise<MoneyActionClaim | null>;
  get(owner: MoneyActionOwner, id: string): Promise<StoredMoneyActionOperation | null>;
  list(
    owner: MoneyActionOwner,
    limit: number,
    scope?: MoneyActionListScope,
  ): Promise<StoredMoneyActionOperation[]>;
  recordSubmission(
    owner: MoneyActionOwner,
    id: string,
    reference: {
      submissionId?: string;
      transactionHash?: `0x${string}`;
      userOperationHash?: `0x${string}`;
    },
    now: string,
  ): Promise<StoredMoneyActionOperation | null>;
  updateStatus(
    owner: MoneyActionOwner,
    id: string,
    status: MoneyActionOperationStatus,
    now: string,
    constraints?: MoneyActionStatusConstraints,
  ): Promise<StoredMoneyActionOperation | null>;
  releaseAdmission(
    owner: MoneyActionOwner,
    id: string,
    now: string,
  ): Promise<StoredMoneyActionOperation | null>;
}

export type VerifiedMoneyActionExecution = {
  chainId: 8453;
  kind: "user-operation" | "transaction";
  hash: `0x${string}`;
};

export type MoneyActionStatusConstraints = {
  expectedSourceStatus?: MoneyActionOperationStatus;
  requireNoSubmissionReference?: boolean;
  verifiedExecution?: VerifiedMoneyActionExecution;
};

export function sameMoneyActionOwner(
  left: MoneyActionOwner,
  right: MoneyActionOwner,
): boolean {
  return (
    left.subject === right.subject &&
    left.address.toLowerCase() === right.address.toLowerCase() &&
    left.chainId === right.chainId &&
    left.accountProvider === right.accountProvider
  );
}

export class MemoryMoneyActionStore implements MoneyActionStore {
  private readonly records = new Map<string, StoredMoneyActionOperation>();
  private readonly sensitiveActions = new Map<string, { action: PreparedMoneyAction; expiresAt: string }>();
  private readonly verifiedExecutions = new Map<string, string>();

  async issue(action: PreparedMoneyAction, options?: MoneyActionIssueStoreOptions): Promise<"issued" | "existing"> {
    const existing = this.records.get(action.id);
    if (existing) {
      if (!sameIssuedAction(existing.action, action)) throw new Error("duplicate-money-action");
      if (options && existing.status === "prepared") this.installSensitiveAction(action.id, options);
      return "existing";
    }
    this.records.set(action.id, {
      action: structuredClone(action),
      status: "prepared",
      attemptCount: 0,
      createdAt: action.createdAt,
      updatedAt: action.createdAt,
    });
    if (options) this.installSensitiveAction(action.id, options);
    return "issued";
  }

  async claim(
    owner: MoneyActionOwner,
    id: string,
    reviewHash: string,
    now: string,
  ): Promise<MoneyActionClaim | null> {
    const record = this.readOwned(owner, id);
    if (!record || record.action.reviewHash !== reviewHash) return null;
    const claimAction = this.claimAction(record, now);
    if (record.status === "prepared" && !claimAction) return null;
    if (record.status === "prepared") {
      if (Date.parse(record.action.expiresAt) <= Date.parse(now)) {
        record.status = "expired";
        record.updatedAt = now;
        return this.claimResult(record, claimAction ?? record.action, "recover");
      }
      record.status = "submitting";
      record.attemptCount += 1;
      record.claimedAt = now;
      record.updatedAt = now;
      return this.claimResult(record, claimAction!, "dispatch");
    }
    return this.claimResult(record, claimAction ?? record.action, "recover");
  }

  async get(owner: MoneyActionOwner, id: string): Promise<StoredMoneyActionOperation | null> {
    const record = this.readOwned(owner, id);
    return record ? structuredClone(record) : null;
  }

  async list(
    owner: MoneyActionOwner,
    limit: number,
    scope?: MoneyActionListScope,
  ): Promise<StoredMoneyActionOperation[]> {
    return [...this.records.values()]
      .filter((record) => sameMoneyActionOwner(owner, record.action.owner))
      .filter((record) => scope !== "unresolved-send" || isUnresolvedSend(record))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async recordSubmission(
    owner: MoneyActionOwner,
    id: string,
    reference: {
      submissionId?: string;
      transactionHash?: `0x${string}`;
      userOperationHash?: `0x${string}`;
    },
    now: string,
  ): Promise<StoredMoneyActionOperation | null> {
    const normalizedReference = {
      ...reference,
      ...(reference.transactionHash ? { transactionHash: reference.transactionHash.toLowerCase() as `0x${string}` } : {}),
      ...(reference.userOperationHash ? { userOperationHash: reference.userOperationHash.toLowerCase() as `0x${string}` } : {}),
    };
    const record = this.readOwned(owner, id);
    if (!record || record.status === "prepared" || record.attemptCount < 1 || !record.claimedAt) return null;
    if (!reference.submissionId && !reference.transactionHash && !reference.userOperationHash) {
      return null;
    }
    if (
      (record.submissionId && normalizedReference.submissionId && record.submissionId !== normalizedReference.submissionId) ||
      (record.transactionHash && normalizedReference.transactionHash && record.transactionHash.toLowerCase() !== normalizedReference.transactionHash) ||
      (record.userOperationHash && normalizedReference.userOperationHash && record.userOperationHash.toLowerCase() !== normalizedReference.userOperationHash) ||
      this.pendingReferenceBelongsToAnotherOwnedAction(owner, id, normalizedReference)
    ) return null;
    record.submissionId ??= normalizedReference.submissionId;
    record.transactionHash ??= normalizedReference.transactionHash;
    record.userOperationHash ??= normalizedReference.userOperationHash;
    if (["submitting", "submitted", "unknown"].includes(record.status)) {
      record.status = "submitted";
    }
    record.updatedAt = now;
    this.sensitiveActions.delete(id);
    return structuredClone(record);
  }

  async updateStatus(
    owner: MoneyActionOwner,
    id: string,
    status: MoneyActionOperationStatus,
    now: string,
    constraints?: MoneyActionStatusConstraints,
  ): Promise<StoredMoneyActionOperation | null> {
    const record = this.readOwned(owner, id);
    if (!record || !canTransition(record, status, constraints)) return null;
    const executionKey = constraints?.verifiedExecution
      ? verifiedExecutionKey(constraints.verifiedExecution)
      : null;
    if (executionKey) {
      if (status !== "confirmed" && status !== "failed") return null;
      const assigned = this.verifiedExecutions.get(executionKey);
      if (assigned && assigned !== id) return null;
      this.verifiedExecutions.set(executionKey, id);
    }
    record.status = status;
    record.updatedAt = now;
    return structuredClone(record);
  }

  async releaseAdmission(
    owner: MoneyActionOwner,
    id: string,
    now: string,
  ): Promise<StoredMoneyActionOperation | null> {
    const record = this.readOwned(owner, id);
    if (!record || !canReleaseMoneyActionAdmission(record)) return null;
    record.abandonedAt ??= now;
    record.updatedAt = now;
    return structuredClone(record);
  }

  private installSensitiveAction(id: string, options: MoneyActionIssueStoreOptions): void {
    this.sensitiveActions.set(id, {
      action: structuredClone(options.sensitiveAction),
      expiresAt: options.sensitivePayloadExpiresAt,
    });
    scheduleSensitivePayloadExpiry(this.sensitiveActions, id, options.sensitivePayloadExpiresAt);
  }

  private claimAction(
    record: StoredMoneyActionOperation,
    now: string,
  ): PreparedMoneyAction | null {
    if (!record.action.sensitivePayload) return record.action;
    const sensitive = this.sensitiveActions.get(record.action.id);
    if (!sensitive || Date.parse(sensitive.expiresAt) <= Date.parse(now)) {
      this.sensitiveActions.delete(record.action.id);
      return null;
    }
    return sensitive.action;
  }

  private claimResult(
    record: StoredMoneyActionOperation,
    action: PreparedMoneyAction,
    disposition: MoneyActionClaim["disposition"],
  ): MoneyActionClaim {
    const claimedAction = structuredClone(action);
    return {
      action: claimedAction,
      operation: { ...structuredClone(record), action: claimedAction },
      disposition,
    };
  }

  private pendingReferenceBelongsToAnotherOwnedAction(
    owner: MoneyActionOwner,
    id: string,
    reference: { submissionId?: string; transactionHash?: `0x${string}`; userOperationHash?: `0x${string}` },
  ): boolean {
    return [...this.records.entries()].some(([otherId, record]) =>
      otherId !== id &&
      sameMoneyActionOwner(owner, record.action.owner) && (
        Boolean(reference.submissionId && record.submissionId === reference.submissionId) ||
        Boolean(reference.userOperationHash && record.userOperationHash?.toLowerCase() === reference.userOperationHash.toLowerCase())
      )
    );
  }

  private readOwned(owner: MoneyActionOwner, id: string) {
    const record = this.records.get(id);
    return record && sameMoneyActionOwner(owner, record.action.owner) ? record : null;
  }
}

const unresolvedSendStatuses = new Set<MoneyActionOperationStatus>([
  "submitting",
  "submitted",
  "included",
  "unknown",
]);

function isUnresolvedSend(record: StoredMoneyActionOperation): boolean {
  return record.action.kind === "send" && unresolvedSendStatuses.has(record.status) && !record.abandonedAt;
}

function verifiedExecutionKey(execution: VerifiedMoneyActionExecution): string {
  return `${execution.chainId}:${execution.kind}:${execution.hash.toLowerCase()}`;
}

function canTransition(
  record: StoredMoneyActionOperation,
  to: MoneyActionOperationStatus,
  constraints?: MoneyActionStatusConstraints,
): boolean {
  return canTransitionMoneyActionStatus(record, to, constraints);
}

function sameIssuedAction(left: PreparedMoneyAction, right: PreparedMoneyAction): boolean {
  return sameMoneyActionOwner(left.owner, right.owner) &&
    left.reviewHash === right.reviewHash &&
    JSON.stringify(left) === JSON.stringify(right);
}

function scheduleSensitivePayloadExpiry(
  actions: Map<string, unknown>,
  id: string,
  expiresAt: string,
): void {
  const timer = setTimeout(
    () => actions.delete(id),
    Math.max(0, Date.parse(expiresAt) - Date.now()),
  );
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}
