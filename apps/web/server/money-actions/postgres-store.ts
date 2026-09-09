import type { MoneyActionOwner, PreparedMoneyAction } from "@/features/money-actions/types";
import { canTransitionMoneyActionStatus } from "./status-transitions.js";
import {
  applyMoneyActionPostgresSchema,
  createNeonSqlExecutor,
  isUniqueViolation,
  moneyActionQueries,
  type OperationRow,
  type SqlExecutor,
} from "./postgres-sql";
import type {
  MoneyActionClaim,
  MoneyActionIssueStoreOptions,
  MoneyActionListScope,
  MoneyActionStatusConstraints,
  MoneyActionStore,
  StoredMoneyActionOperation,
  VerifiedMoneyActionExecution,
} from "./store";

export class PostgresMoneyActionStore implements MoneyActionStore {
  private readonly executor: SqlExecutor;
  private readonly sensitiveActions = new Map<string, { action: PreparedMoneyAction; expiresAt: string }>();
  private schemaReady: Promise<void> | null = null;

  constructor(executorOrUrl?: SqlExecutor | string) {
    if (typeof executorOrUrl === "object") {
      this.executor = executorOrUrl;
      return;
    }
    const url = executorOrUrl?.trim() || process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error("DATABASE_URL is required for PostgresMoneyActionStore");
    }
    this.executor = createNeonSqlExecutor(url);
  }

  async ensureSchema(): Promise<void> {
    this.schemaReady ??= applyMoneyActionPostgresSchema(this.executor);
    await this.schemaReady;
  }

  async issue(action: PreparedMoneyAction, options?: MoneyActionIssueStoreOptions): Promise<"issued" | "existing"> {
    await this.ensureSchema();
    try {
      const result = await this.executor.transaction(async (tx) => {
        const existing = await this.getRowById(tx, action.id, true);
        if (existing) {
          const stored = parseAction(existing.action_json);
          if (!sameIssuedAction(stored, action)) throw new Error("duplicate-money-action");
          return "existing" as const;
        }
        await tx.query(moneyActionQueries.insert, [
          action.id,
          action.reviewHash,
          action.owner.subject,
          action.owner.address.toLowerCase(),
          action.owner.chainId,
          action.owner.accountProvider,
          JSON.stringify(action),
          action.createdAt,
          action.createdAt,
        ]);
        return "issued" as const;
      });
      if (options && (result === "issued" || (await this.getRowById(this.executor, action.id))?.status === "prepared")) {
        this.installSensitiveAction(action.id, options);
      }
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.getRowById(this.executor, action.id);
        if (!existing || !sameIssuedAction(parseAction(existing.action_json), action)) {
          throw new Error("duplicate-money-action");
        }
        if (options && existing.status === "prepared") this.installSensitiveAction(action.id, options);
        return "existing";
      }
      throw error;
    }
  }

  async claim(
    owner: MoneyActionOwner,
    id: string,
    reviewHash: string,
    now: string,
  ): Promise<MoneyActionClaim | null> {
    await this.ensureSchema();
    return this.executor.transaction(async (tx) => {
      let row = await this.getRow(tx, owner, id, true);
      if (!row) return null;
      const action = parseAction(row.action_json);
      if (action.reviewHash !== reviewHash) return null;
      const claimAction = this.claimAction(action, now);
      if (row.status === "prepared" && !claimAction) return null;
      let disposition: MoneyActionClaim["disposition"] = "recover";
      if (row.status === "prepared") {
        if (Date.parse(action.expiresAt) <= Date.parse(now)) {
          await tx.query(moneyActionQueries.expire, [now, id]);
        } else {
          const changed = await tx.query(moneyActionQueries.dispatch, [now, now, id]);
          disposition = changed.rowCount === 1 ? "dispatch" : "recover";
        }
        row = (await this.getRow(tx, owner, id))!;
      }
      const returnedAction = claimAction ?? action;
      return { action: returnedAction, operation: fromRow(row, returnedAction), disposition };
    });
  }

  async get(owner: MoneyActionOwner, id: string): Promise<StoredMoneyActionOperation | null> {
    await this.ensureSchema();
    const row = await this.getRow(this.executor, owner, id);
    return row ? fromRow(row) : null;
  }

  async list(
    owner: MoneyActionOwner,
    limit: number,
    scope?: MoneyActionListScope,
  ): Promise<StoredMoneyActionOperation[]> {
    await this.ensureSchema();
    const query = scope === "unresolved-send"
      ? moneyActionQueries.listOwnedUnresolvedSends
      : moneyActionQueries.listOwned;
    const result = await this.executor.query<OperationRow>(query, [
      ...ownerParameters(owner),
      limit,
    ]);
    return result.rows.map((row) => fromRow(normalizeRow(row)));
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
    if (!reference.submissionId && !reference.transactionHash && !reference.userOperationHash) return null;
    await this.ensureSchema();
    const updated = await this.executor.transaction(async (tx) => {
      const row = await this.getRow(tx, owner, id, true);
      if (
        !row ||
        !["submitting", "submitted", "unknown"].includes(row.status) ||
        (row.submission_id && reference.submissionId && row.submission_id !== reference.submissionId) ||
        (row.transaction_hash && reference.transactionHash && row.transaction_hash !== reference.transactionHash) ||
        (row.user_operation_hash && reference.userOperationHash && row.user_operation_hash !== reference.userOperationHash) ||
        await this.pendingReferenceBelongsToAnotherOwnedAction(tx, owner, id, reference)
      ) {
        return null;
      }
      await tx.query(moneyActionQueries.recordSubmission, [
        reference.submissionId ?? null,
        reference.transactionHash ?? null,
        reference.userOperationHash ?? null,
        now,
        id,
        ...ownerParameters(owner),
      ]);
      return this.getRow(tx, owner, id);
    });
    if (!updated) return null;
    this.sensitiveActions.delete(id);
    return fromRow(updated);
  }

  async updateStatus(
    owner: MoneyActionOwner,
    id: string,
    status: StoredMoneyActionOperation["status"],
    now: string,
    constraints?: MoneyActionStatusConstraints,
  ): Promise<StoredMoneyActionOperation | null> {
    await this.ensureSchema();
    try {
      return await this.executor.transaction(async (tx) => {
        const row = await this.getRow(tx, owner, id, true);
        const existing = row ? fromRow(row) : null;
        const executionKey = constraints?.verifiedExecution
          ? verifiedExecutionKey(constraints.verifiedExecution)
          : null;
        if (
          !existing ||
          !canTransitionMoneyActionStatus(existing, status, constraints) ||
          (executionKey && status !== "confirmed" && status !== "failed") ||
          (executionKey && row?.verified_execution_key && row.verified_execution_key !== executionKey) ||
          (executionKey && await this.verifiedExecutionBelongsToAnotherAction(tx, id, executionKey))
        ) {
          return null;
        }
        const changed = await tx.query(moneyActionQueries.updateStatus, [
          status,
          now,
          executionKey,
          id,
          ...ownerParameters(owner),
          existing.status,
        ]);
        if (changed.rowCount !== 1) return null;
        const updated = await this.getRow(tx, owner, id);
        return updated ? fromRow(updated) : null;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  private installSensitiveAction(id: string, options: MoneyActionIssueStoreOptions): void {
    this.sensitiveActions.set(id, {
      action: structuredClone(options.sensitiveAction),
      expiresAt: options.sensitivePayloadExpiresAt,
    });
    const timer = setTimeout(
      () => this.sensitiveActions.delete(id),
      Math.max(0, Date.parse(options.sensitivePayloadExpiresAt) - Date.now()),
    );
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private claimAction(action: PreparedMoneyAction, now: string): PreparedMoneyAction | null {
    if (!action.sensitivePayload) return action;
    const sensitive = this.sensitiveActions.get(action.id);
    if (!sensitive || Date.parse(sensitive.expiresAt) <= Date.parse(now)) {
      this.sensitiveActions.delete(action.id);
      return null;
    }
    return structuredClone(sensitive.action);
  }

  private async pendingReferenceBelongsToAnotherOwnedAction(
    executor: SqlExecutor,
    owner: MoneyActionOwner,
    id: string,
    reference: { submissionId?: string; transactionHash?: `0x${string}`; userOperationHash?: `0x${string}` },
  ): Promise<boolean> {
    const result = await executor.query(moneyActionQueries.pendingReference, [
      id,
      ...ownerParameters(owner),
      reference.submissionId ?? null,
      reference.userOperationHash ?? null,
    ]);
    return result.rows.length > 0;
  }

  private async verifiedExecutionBelongsToAnotherAction(
    executor: SqlExecutor,
    id: string,
    executionKey: string,
  ): Promise<boolean> {
    const result = await executor.query(moneyActionQueries.verifiedExecutionOther, [id, executionKey]);
    return result.rows.length > 0;
  }

  private async getRowById(executor: SqlExecutor, id: string, forUpdate = false): Promise<OperationRow | null> {
    const result = await executor.query<OperationRow>(
      forUpdate ? moneyActionQueries.selectByIdForUpdate : moneyActionQueries.selectById,
      [id],
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  private async getRow(
    executor: SqlExecutor,
    owner: MoneyActionOwner,
    id: string,
    forUpdate = false,
  ): Promise<OperationRow | null> {
    const result = await executor.query<OperationRow>(
      forUpdate ? moneyActionQueries.selectOwnedForUpdate : moneyActionQueries.selectOwned,
      [id, ...ownerParameters(owner)],
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }
}

function verifiedExecutionKey(execution: VerifiedMoneyActionExecution): string {
  return `${execution.chainId}:${execution.kind}:${execution.hash.toLowerCase()}`;
}

function ownerParameters(owner: MoneyActionOwner): [string, string, number, string] {
  return [owner.subject, owner.address.toLowerCase(), owner.chainId, owner.accountProvider];
}

function parseAction(value: string): PreparedMoneyAction {
  return JSON.parse(value) as PreparedMoneyAction;
}

function sameIssuedAction(left: PreparedMoneyAction, right: PreparedMoneyAction): boolean {
  return left.reviewHash === right.reviewHash &&
    left.owner.subject === right.owner.subject &&
    left.owner.address.toLowerCase() === right.owner.address.toLowerCase() &&
    left.owner.chainId === right.owner.chainId &&
    left.owner.accountProvider === right.owner.accountProvider &&
    JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRow(row: OperationRow): OperationRow {
  return {
    ...row,
    attempt_count: Number(row.attempt_count),
    claimed_at: row.claimed_at ?? null,
    submission_id: row.submission_id ?? null,
    transaction_hash: row.transaction_hash ?? null,
    user_operation_hash: row.user_operation_hash ?? null,
    verified_execution_key: row.verified_execution_key ?? null,
  };
}

function fromRow(
  row: OperationRow,
  action = parseAction(row.action_json),
): StoredMoneyActionOperation {
  return {
    action,
    status: row.status as StoredMoneyActionOperation["status"],
    attemptCount: Number(row.attempt_count),
    claimedAt: row.claimed_at ?? undefined,
    submissionId: row.submission_id ?? undefined,
    transactionHash: row.transaction_hash as `0x${string}` | null ?? undefined,
    userOperationHash: row.user_operation_hash as `0x${string}` | null ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { applyMoneyActionPostgresSchema, createNeonSqlExecutor } from "./postgres-sql";
