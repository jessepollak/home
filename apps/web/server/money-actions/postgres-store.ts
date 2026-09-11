import type { MoneyActionOwner, PreparedMoneyAction } from "@/features/money-actions/types";
import { canTransitionMoneyActionStatus } from "./status-transitions.js";
import {
  AttemptPersistenceConflict,
  PersistentMoneyActionAttemptStore,
  evidenceUniquenessKey,
  type AttemptOperationRecord,
  type AttemptStorePersistence,
  type AttemptStoreTransaction,
  type PersistedAttemptState,
// @ts-expect-error Node requires the explicit TypeScript extension.
} from "./attempt-store-core.ts";
import type { AttemptStoreResource, AttemptStoreResourceFactory } from "./attempt-store";
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
        row.status === "prepared" ||
        Number(row.attempt_count) < 1 ||
        !row.claimed_at ||
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

  async releaseAdmission(
    owner: MoneyActionOwner,
    id: string,
    now: string,
  ): Promise<StoredMoneyActionOperation | null> {
    await this.ensureSchema();
    return this.executor.transaction(async (tx) => {
      const changed = await tx.query(moneyActionQueries.releaseAdmission, [
        now,
        now,
        id,
        ...ownerParameters(owner),
      ]);
      if (changed.rowCount !== 1) return null;
      const updated = await this.getRow(tx, owner, id);
      return updated ? fromRow(updated) : null;
    });
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
    abandoned_at: row.abandoned_at ?? null,
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
    abandonedAt: row.abandoned_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { applyMoneyActionPostgresSchema, createNeonSqlExecutor } from "./postgres-sql";

class PostgresAttemptPersistence implements AttemptStorePersistence {
  private disposed = false;

  constructor(
    private readonly executor: SqlExecutor,
    private readonly legacy: PostgresMoneyActionStore,
  ) {}

  async init(): Promise<void> {
    this.assertOpen();
    await this.legacy.ensureSchema();
  }

  async listOperationIds(): Promise<string[]> {
    this.assertOpen();
    const result = await this.executor.query<{ id: string }>("SELECT id FROM money_action_operations ORDER BY id");
    return result.rows.map((row) => row.id);
  }

  async transaction<Result>(run: (transaction: AttemptStoreTransaction) => Promise<Result>): Promise<Result> {
    this.assertOpen();
    try {
      return await this.executor.transaction(async (executor) => run(this.transactionAdapter(executor)));
    } catch (error) {
      if (isUniqueViolation(error)) {
        const message = error instanceof Error ? error.message : String(error);
        throw new AttemptPersistenceConflict(message.includes("verified_execution") ? "verified-execution" : "evidence");
      }
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const disposal = this.executor.dispose?.();
    if (disposal) await withCleanupTimeout(disposal, 5_000);
  }

  private transactionAdapter(executor: SqlExecutor): AttemptStoreTransaction {
    return {
      getOperationById: async (actionId) => this.getOperation(executor, actionId),
      insertOperation: async (record) => this.insertOperation(executor, record),
      saveOperation: async (record) => this.saveOperation(executor, record),
      getState: async (actionId) => this.getState(executor, actionId),
      saveState: async (actionId, state) => this.saveState(executor, actionId, state),
      findEvidenceOwner: async (key) => {
        const result = await executor.query<{ action_id: string }>(
          "SELECT action_id FROM money_action_attempt_evidence WHERE evidence_key = $1",
          [key],
        );
        return result.rows[0]?.action_id ?? null;
      },
      findVerifiedExecutionOwner: async (key) => {
        const result = await executor.query<{ action_id: string }>(
          "SELECT action_id FROM money_action_attempt_states WHERE verified_execution_key = $1",
          [key],
        );
        return result.rows[0]?.action_id ?? null;
      },
    };
  }

  private async getOperation(executor: SqlExecutor, actionId: string): Promise<AttemptOperationRecord | null> {
    const result = await executor.query<OperationRow>(`
      SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
             user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
      FROM money_action_operations WHERE id = $1 FOR UPDATE
    `.trim(), [actionId]);
    const row = result.rows[0] ? normalizeRow(result.rows[0]) : null;
    return row ? {
      operation: fromRow(row),
      ...(row.verified_execution_key ? { verifiedExecutionKey: row.verified_execution_key } : {}),
    } : null;
  }

  private async insertOperation(executor: SqlExecutor, record: AttemptOperationRecord): Promise<void> {
    const action = record.operation.action;
    await executor.query(`
      INSERT INTO money_action_operations (
        id, review_hash, subject, address, chain_id, account_provider, action_json, status,
        attempt_count, claimed_at, submission_id, transaction_hash, user_operation_hash,
        verified_execution_key, abandoned_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `.trim(), [
      action.id, action.reviewHash, action.owner.subject, action.owner.address.toLowerCase(),
      action.owner.chainId, action.owner.accountProvider, JSON.stringify(action), record.operation.status,
      record.operation.attemptCount, record.operation.claimedAt ?? null, record.operation.submissionId ?? null,
      record.operation.transactionHash ?? null, record.operation.userOperationHash ?? null,
      record.verifiedExecutionKey ?? null, record.operation.abandonedAt ?? null,
      record.operation.createdAt, record.operation.updatedAt,
    ]);
  }

  private async saveOperation(executor: SqlExecutor, record: AttemptOperationRecord): Promise<void> {
    const operation = record.operation;
    await executor.query(`
      UPDATE money_action_operations SET
        action_json = $1, review_hash = $2, status = $3, attempt_count = $4, claimed_at = $5,
        submission_id = $6, transaction_hash = $7, user_operation_hash = $8,
        verified_execution_key = $9, abandoned_at = $10, updated_at = $11
      WHERE id = $12
    `.trim(), [
      JSON.stringify(operation.action), operation.action.reviewHash, operation.status, operation.attemptCount,
      operation.claimedAt ?? null, operation.submissionId ?? null, operation.transactionHash ?? null,
      operation.userOperationHash ?? null, record.verifiedExecutionKey ?? null,
      operation.abandonedAt ?? null, operation.updatedAt, operation.action.id,
    ]);
  }

  private async getState(executor: SqlExecutor, actionId: string): Promise<PersistedAttemptState | null> {
    const result = await executor.query<{ state_json: string }>(
      "SELECT state_json FROM money_action_attempt_states WHERE action_id = $1",
      [actionId],
    );
    return result.rows[0] ? JSON.parse(result.rows[0].state_json) as PersistedAttemptState : null;
  }

  private async saveState(executor: SqlExecutor, actionId: string, state: PersistedAttemptState): Promise<void> {
    await executor.query(`
      INSERT INTO money_action_attempt_states (action_id, state_json, verified_execution_key, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(action_id) DO UPDATE SET
        state_json = EXCLUDED.state_json,
        verified_execution_key = EXCLUDED.verified_execution_key,
        updated_at = EXCLUDED.updated_at
    `.trim(), [actionId, JSON.stringify(state), state.verifiedExecutionKey ?? null, new Date().toISOString()]);
    await executor.query("DELETE FROM money_action_attempt_evidence WHERE action_id = $1", [actionId]);
    for (const attempt of state.attempts) {
      for (const recorded of attempt.evidence) {
        const key = evidenceUniquenessKey(attempt.owner, recorded.evidence);
        if (key) {
          await executor.query(
            "INSERT INTO money_action_attempt_evidence (evidence_key, action_id) VALUES ($1, $2)",
            [key, actionId],
          );
        }
      }
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("PostgreSQL attempt persistence is disposed");
  }
}

export function createPostgresAttemptStoreResourceWithExecutor(executor: SqlExecutor): AttemptStoreResource {
  const legacy = new PostgresMoneyActionStore(executor);
  const persistence = new PostgresAttemptPersistence(executor, legacy);
  const store = new PersistentMoneyActionAttemptStore(legacy, persistence);
  return { store, init: () => store.init(), dispose: () => store.dispose() };
}

export const createPostgresAttemptStoreResource: AttemptStoreResourceFactory = (options) => {
  if (options.backend !== "postgres") throw new Error("PostgreSQL attempt-store factory requires postgres options");
  return createPostgresAttemptStoreResourceWithExecutor(
    createNeonSqlExecutor(options.connectionString, { schema: options.schema }),
  );
};

async function withCleanupTimeout(disposal: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      disposal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`PostgreSQL attempt-store cleanup timed out after ${timeoutMs}ms`)), timeoutMs);
        (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
