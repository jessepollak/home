import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/features/money-actions/types";
import type { ProviderEvidence } from "./attempt-commands";
import { canTransitionMoneyActionStatus } from "./status-transitions.js";
// Node's built-in TypeScript loader requires the extension for the real SQLite process gate.
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
import type { AttemptStoreResourceFactory, MoneyActionAttemptStore } from "./attempt-store";
import type {
  MoneyActionClaim,
  MoneyActionIssueStoreOptions,
  MoneyActionListScope,
  MoneyActionStatusConstraints,
  MoneyActionStore,
  StoredMoneyActionOperation,
  VerifiedMoneyActionExecution,
} from "./store";

type OperationRow = {
  action_json: string;
  status: StoredMoneyActionOperation["status"];
  attempt_count: number;
  claimed_at: string | null;
  submission_id: string | null;
  transaction_hash: string | null;
  user_operation_hash: string | null;
  verified_execution_key: string | null;
  abandoned_at: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteMoneyActionStore implements MoneyActionStore {
  private readonly database: DatabaseSync;
  private readonly sensitiveActions = new Map<string, { action: PreparedMoneyAction; expiresAt: string }>();
  private readonly nonBlockingWrites: boolean;

  constructor(path = defaultDatabasePath(), options: Readonly<{ nonBlockingWrites?: boolean }> = {}) {
    this.nonBlockingWrites = options.nonBlockingWrites ?? false;
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${this.nonBlockingWrites ? 0 : 5000};`);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS money_action_operations (
        id TEXT PRIMARY KEY,
        review_hash TEXT NOT NULL,
        subject TEXT NOT NULL,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL CHECK (chain_id = 8453),
        account_provider TEXT NOT NULL,
        action_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT,
        submission_id TEXT,
        transaction_hash TEXT,
        user_operation_hash TEXT,
        verified_execution_key TEXT,
        abandoned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS money_action_owner_recent
      ON money_action_operations(subject, address, chain_id, account_provider, updated_at DESC);
    `);
    this.ensureColumn("claimed_at", "TEXT");
    this.ensureColumn("verified_execution_key", "TEXT");
    this.ensureColumn("abandoned_at", "TEXT");
    this.database.exec(`
      DROP INDEX IF EXISTS money_action_unique_submission_id;
      DROP INDEX IF EXISTS money_action_unique_transaction_hash;
      DROP INDEX IF EXISTS money_action_unique_user_operation_hash;
      CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_verified_execution
      ON money_action_operations(verified_execution_key) WHERE verified_execution_key IS NOT NULL;
    `);
  }

  async issue(action: PreparedMoneyAction, options?: MoneyActionIssueStoreOptions): Promise<"issued" | "existing"> {
    const pendingWrite = this.beginWrite();
    if (pendingWrite) await pendingWrite;
    try {
      const existing = this.getRowById(action.id);
      if (existing) {
        const stored = parseAction(existing.action_json);
        if (
          stored.reviewHash !== action.reviewHash ||
          stored.owner.subject !== action.owner.subject ||
          stored.owner.address.toLowerCase() !== action.owner.address.toLowerCase() ||
          stored.owner.chainId !== action.owner.chainId ||
          stored.owner.accountProvider !== action.owner.accountProvider ||
          JSON.stringify(stored) !== JSON.stringify(action)
        ) {
          this.database.exec("ROLLBACK");
          throw new Error("duplicate-money-action");
        }
        this.database.exec("COMMIT");
        if (options && existing.status === "prepared") this.installSensitiveAction(action.id, options);
        return "existing";
      }
      this.database.prepare(`
        INSERT INTO money_action_operations (
          id, review_hash, subject, address, chain_id, account_provider,
          action_json, status, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', 0, ?, ?)
      `).run(
        action.id,
        action.reviewHash,
        action.owner.subject,
        action.owner.address.toLowerCase(),
        action.owner.chainId,
        action.owner.accountProvider,
        JSON.stringify(action),
        action.createdAt,
        action.createdAt,
      );
      this.database.exec("COMMIT");
      if (options) this.installSensitiveAction(action.id, options);
      return "issued";
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  async claim(
    owner: MoneyActionOwner,
    id: string,
    reviewHash: string,
    now: string,
  ): Promise<MoneyActionClaim | null> {
    const pendingWrite = this.beginWrite();
    if (pendingWrite) await pendingWrite;
    try {
      let row = this.getRow(owner, id);
      if (!row) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const action = parseAction(row.action_json);
      if (action.reviewHash !== reviewHash) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const claimAction = this.claimAction(action, now);
      if (row.status === "prepared" && !claimAction) {
        this.database.exec("ROLLBACK");
        return null;
      }
      let disposition: MoneyActionClaim["disposition"] = "recover";
      if (row.status === "prepared") {
        if (Date.parse(action.expiresAt) <= Date.parse(now)) {
          this.database.prepare(`UPDATE money_action_operations SET status = 'expired', updated_at = ? WHERE id = ?`).run(now, id);
        } else {
          const changed = this.database.prepare(`
            UPDATE money_action_operations
            SET status = 'submitting', attempt_count = attempt_count + 1,
                claimed_at = COALESCE(claimed_at, ?), updated_at = ?
            WHERE id = ? AND status = 'prepared'
          `).run(now, now, id);
          disposition = changed.changes === 1 ? "dispatch" : "recover";
        }
        row = this.getRow(owner, id)!;
      }
      this.database.exec("COMMIT");
      const returnedAction = claimAction ?? action;
      return { action: returnedAction, operation: fromRow(row, returnedAction), disposition };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async get(owner: MoneyActionOwner, id: string): Promise<StoredMoneyActionOperation | null> {
    const row = this.getRow(owner, id);
    return row ? fromRow(row) : null;
  }

  async list(
    owner: MoneyActionOwner,
    limit: number,
    scope?: MoneyActionListScope,
  ): Promise<StoredMoneyActionOperation[]> {
    const scopeClause = scope === "unresolved-send"
      ? ` AND status IN ('submitting', 'submitted', 'included', 'unknown')
          AND abandoned_at IS NULL
          AND json_extract(action_json, '$.kind') = 'send'`
      : "";
    const rows = this.database.prepare(`
      SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
             user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
      FROM money_action_operations
      WHERE subject = ? AND address = ? AND chain_id = ? AND account_provider = ?${scopeClause}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...ownerParameters(owner), limit) as unknown as OperationRow[];
    return rows.map((row) => fromRow(row));
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
    const pendingWrite = this.beginWrite();
    if (pendingWrite) await pendingWrite;
    try {
      const row = this.getRow(owner, id);
      if (
        !row ||
        row.status === "prepared" ||
        row.attempt_count < 1 ||
        !row.claimed_at ||
        (row.submission_id && reference.submissionId && row.submission_id !== reference.submissionId) ||
        (row.transaction_hash && reference.transactionHash && row.transaction_hash !== reference.transactionHash) ||
        (row.user_operation_hash && reference.userOperationHash && row.user_operation_hash !== reference.userOperationHash) ||
        this.pendingReferenceBelongsToAnotherOwnedAction(owner, id, reference)
      ) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.prepare(`
        UPDATE money_action_operations
        SET status = CASE
              WHEN status IN ('submitting', 'submitted', 'unknown') THEN 'submitted'
              ELSE status
            END,
            submission_id = COALESCE(submission_id, ?),
            transaction_hash = COALESCE(transaction_hash, ?),
            user_operation_hash = COALESCE(user_operation_hash, ?),
            updated_at = ?
        WHERE id = ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
      `).run(
        reference.submissionId ?? null,
        reference.transactionHash ?? null,
        reference.userOperationHash ?? null,
        now,
        id,
        ...ownerParameters(owner),
      );
      const updated = this.getRow(owner, id);
      this.database.exec("COMMIT");
      this.sensitiveActions.delete(id);
      return updated ? fromRow(updated) : null;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async updateStatus(
    owner: MoneyActionOwner,
    id: string,
    status: StoredMoneyActionOperation["status"],
    now: string,
    constraints?: MoneyActionStatusConstraints,
  ): Promise<StoredMoneyActionOperation | null> {
    const pendingWrite = this.beginWrite();
    if (pendingWrite) await pendingWrite;
    try {
      const row = this.getRow(owner, id);
      const existing = row ? fromRow(row) : null;
      const executionKey = constraints?.verifiedExecution
        ? verifiedExecutionKey(constraints.verifiedExecution)
        : null;
      if (
        !existing ||
        !canTransitionMoneyActionStatus(existing, status, constraints) ||
        (executionKey && status !== "confirmed" && status !== "failed") ||
        (executionKey && row?.verified_execution_key && row.verified_execution_key !== executionKey) ||
        (executionKey && this.verifiedExecutionBelongsToAnotherAction(id, executionKey))
      ) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const changed = this.database.prepare(`
        UPDATE money_action_operations
        SET status = ?, updated_at = ?, verified_execution_key = COALESCE(verified_execution_key, ?)
        WHERE id = ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
          AND status = ?
      `).run(status, now, executionKey, id, ...ownerParameters(owner), existing.status);
      const updated = changed.changes === 1 ? this.getRow(owner, id) : null;
      this.database.exec("COMMIT");
      return updated ? fromRow(updated) : null;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async releaseAdmission(
    owner: MoneyActionOwner,
    id: string,
    now: string,
  ): Promise<StoredMoneyActionOperation | null> {
    const pendingWrite = this.beginWrite();
    if (pendingWrite) await pendingWrite;
    try {
      const changed = this.database.prepare(`
        UPDATE money_action_operations
        SET abandoned_at = COALESCE(abandoned_at, ?), updated_at = ?
        WHERE id = ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
          AND status IN ('submitting', 'submitted', 'included', 'unknown')
      `).run(now, now, id, ...ownerParameters(owner));
      const updated = changed.changes === 1 ? this.getRow(owner, id) : null;
      this.database.exec("COMMIT");
      return updated ? fromRow(updated) : null;
    } catch (error) {
      this.database.exec("ROLLBACK");
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

  private pendingReferenceBelongsToAnotherOwnedAction(
    owner: MoneyActionOwner,
    id: string,
    reference: { submissionId?: string; transactionHash?: `0x${string}`; userOperationHash?: `0x${string}` },
  ): boolean {
    const row = this.database.prepare(`
      SELECT id FROM money_action_operations
      WHERE id <> ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ? AND (
        (? IS NOT NULL AND submission_id = ?) OR
        (? IS NOT NULL AND user_operation_hash = ?)
      ) LIMIT 1
    `).get(
      id,
      ...ownerParameters(owner),
      reference.submissionId ?? null,
      reference.submissionId ?? null,
      reference.userOperationHash ?? null,
      reference.userOperationHash ?? null,
    );
    return Boolean(row);
  }

  private verifiedExecutionBelongsToAnotherAction(id: string, executionKey: string): boolean {
    return Boolean(this.database.prepare(`
      SELECT id FROM money_action_operations
      WHERE id <> ? AND verified_execution_key = ?
      LIMIT 1
    `).get(id, executionKey));
  }

  close(): void {
    this.sensitiveActions.clear();
    this.database.close();
  }

  private beginWrite(): Promise<void> | null {
    if (!this.nonBlockingWrites) {
      this.database.exec("BEGIN IMMEDIATE");
      return null;
    }
    return this.beginWriteWithRetry();
  }

  private async beginWriteWithRetry(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        this.database.exec("BEGIN IMMEDIATE");
        return;
      } catch (error) {
        if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  private ensureColumn(name: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(money_action_operations)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE money_action_operations ADD COLUMN ${name} ${definition}`);
    }
  }

  private getRowById(id: string): OperationRow | null {
    return (this.database.prepare(`
      SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
             user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
      FROM money_action_operations WHERE id = ?
    `).get(id) as unknown as OperationRow | undefined) ?? null;
  }

  private getRow(owner: MoneyActionOwner, id: string): OperationRow | null {
    return (this.database.prepare(`
      SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
             user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
      FROM money_action_operations
      WHERE id = ? AND subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
    `).get(id, ...ownerParameters(owner)) as unknown as OperationRow | undefined) ?? null;
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

function fromRow(
  row: OperationRow,
  action = parseAction(row.action_json),
): StoredMoneyActionOperation {
  return {
    action,
    status: row.status,
    attemptCount: row.attempt_count,
    claimedAt: row.claimed_at ?? undefined,
    submissionId: row.submission_id ?? undefined,
    transactionHash: row.transaction_hash as `0x${string}` | null ?? undefined,
    userOperationHash: row.user_operation_hash as `0x${string}` | null ?? undefined,
    abandonedAt: row.abandoned_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultDatabasePath(): string {
  return resolve(process.cwd(), ".local", "home-money-actions.sqlite");
}

class SqliteAttemptPersistence implements AttemptStorePersistence {
  private readonly database: DatabaseSync;
  private readonly legacy: SqliteMoneyActionStore;
  private disposed = false;
  private transactionGate: Promise<void> = Promise.resolve();

  constructor(filename: string, legacy: SqliteMoneyActionStore) {
    this.legacy = legacy;
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0;");
  }

  async init(): Promise<void> {
    this.assertOpen();
    this.database.exec(SQLITE_ATTEMPT_SCHEMA_SQL);
  }

  async listOperationIds(): Promise<string[]> {
    this.assertOpen();
    const rows = this.database.prepare("SELECT id FROM money_action_operations ORDER BY id").all() as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  async transaction<Result>(run: (transaction: AttemptStoreTransaction) => Promise<Result>): Promise<Result> {
    this.assertOpen();
    let release!: () => void;
    const previous = this.transactionGate;
    this.transactionGate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await this.beginImmediate();
      try {
        const result = await run(this.transactionAdapter());
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try { this.database.exec("ROLLBACK"); } catch { /* preserve original failure */ }
        if (isSqliteUniqueViolation(error)) {
          const message = error instanceof Error ? error.message : String(error);
          throw new AttemptPersistenceConflict(message.includes("verified_execution") ? "verified-execution" : "evidence");
        }
        throw error;
      }
    } finally {
      release();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    try { this.database.close(); } catch (error) { failures.push(error); }
    try { this.legacy.close(); } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new AggregateError(failures, "SQLite attempt-store cleanup failed");
  }

  private transactionAdapter(): AttemptStoreTransaction {
    return {
      getOperationById: async (actionId) => this.getOperation(actionId),
      insertOperation: async (record) => this.insertOperation(record),
      saveOperation: async (record) => this.saveOperation(record),
      getState: async (actionId) => this.getState(actionId),
      saveState: async (actionId, state) => this.saveState(actionId, state),
      findEvidenceOwner: async (key) => {
        const row = this.database.prepare("SELECT action_id FROM money_action_attempt_evidence WHERE evidence_key = ?").get(key) as { action_id: string } | undefined;
        return row?.action_id ?? null;
      },
      findLegacyEvidenceOwner: async (owner, evidence) => this.findLegacyEvidenceOwner(owner, evidence),
      findVerifiedExecutionOwner: async (key) => {
        const row = this.database.prepare(`
          SELECT action_id FROM money_action_attempt_states WHERE verified_execution_key = ?
          UNION ALL
          SELECT id AS action_id FROM money_action_operations WHERE verified_execution_key = ?
          LIMIT 1
        `).get(key, key) as { action_id: string } | undefined;
        return row?.action_id ?? null;
      },
    };
  }

  private getOperation(actionId: string): AttemptOperationRecord | null {
    const row = this.database.prepare(`
      SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
             user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
      FROM money_action_operations WHERE id = ?
    `).get(actionId) as OperationRow | undefined;
    return row ? { operation: fromRow(row), ...(row.verified_execution_key ? { verifiedExecutionKey: row.verified_execution_key } : {}) } : null;
  }

  private insertOperation(record: AttemptOperationRecord): boolean {
    const action = record.operation.action;
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO money_action_operations (
        id, review_hash, subject, address, chain_id, account_provider, action_json, status,
        attempt_count, claimed_at, submission_id, transaction_hash, user_operation_hash,
        verified_execution_key, abandoned_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      action.id, action.reviewHash, action.owner.subject, action.owner.address.toLowerCase(),
      action.owner.chainId, action.owner.accountProvider, JSON.stringify(action), record.operation.status,
      record.operation.attemptCount, record.operation.claimedAt ?? null, record.operation.submissionId ?? null,
      record.operation.transactionHash ?? null, record.operation.userOperationHash ?? null,
      record.verifiedExecutionKey ?? null, record.operation.abandonedAt ?? null,
      record.operation.createdAt, record.operation.updatedAt,
    );
    return result.changes === 1;
  }

  private findLegacyEvidenceOwner(owner: MoneyActionOwner, evidence: ProviderEvidence): string | null {
    const lead = evidence.kind === "provider-status" ? evidence.handle : evidence;
    if (lead.kind === "transaction-hash") return null;
    const column = lead.kind === "submission-id" ? "submission_id" : "user_operation_hash";
    const value = lead.kind === "user-operation-hash" ? lead.value.toLowerCase() : lead.value;
    const comparison = lead.kind === "user-operation-hash" ? `LOWER(${column}) = ?` : `${column} = ?`;
    const row = this.database.prepare(`
      SELECT id FROM money_action_operations
      WHERE subject = ? AND address = ? AND chain_id = ? AND account_provider = ?
        AND ${comparison}
      LIMIT 1
    `).get(...ownerParameters(owner), value) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private saveOperation(record: AttemptOperationRecord): void {
    const operation = record.operation;
    this.database.prepare(`
      UPDATE money_action_operations SET
        action_json = ?, review_hash = ?, status = ?, attempt_count = ?, claimed_at = ?,
        submission_id = ?, transaction_hash = ?, user_operation_hash = ?, verified_execution_key = ?,
        abandoned_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(operation.action), operation.action.reviewHash, operation.status, operation.attemptCount,
      operation.claimedAt ?? null, operation.submissionId ?? null, operation.transactionHash ?? null,
      operation.userOperationHash ?? null, record.verifiedExecutionKey ?? null,
      operation.abandonedAt ?? null, operation.updatedAt, operation.action.id,
    );
  }

  private getState(actionId: string): PersistedAttemptState | null {
    const row = this.database.prepare("SELECT state_json FROM money_action_attempt_states WHERE action_id = ?").get(actionId) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) as PersistedAttemptState : null;
  }

  private saveState(actionId: string, state: PersistedAttemptState): void {
    this.database.prepare(`
      INSERT INTO money_action_attempt_states (action_id, state_json, verified_execution_key, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(action_id) DO UPDATE SET
        state_json = excluded.state_json,
        verified_execution_key = excluded.verified_execution_key,
        updated_at = excluded.updated_at
    `).run(actionId, JSON.stringify(state), state.verifiedExecutionKey ?? null, new Date().toISOString());
    this.database.prepare("DELETE FROM money_action_attempt_evidence WHERE action_id = ?").run(actionId);
    const insert = this.database.prepare("INSERT INTO money_action_attempt_evidence (evidence_key, action_id) VALUES (?, ?)");
    const reservations = new Set(state.legacyEvidenceReservations ?? []);
    for (const attempt of state.attempts) {
      for (const recorded of attempt.evidence) {
        const key = evidenceUniquenessKey(attempt.owner, recorded.evidence);
        if (key) reservations.add(key);
      }
    }
    for (const key of reservations) insert.run(key, actionId);
  }

  private async beginImmediate(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        this.database.exec("BEGIN IMMEDIATE");
        return;
      } catch (error) {
        if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("SQLite attempt persistence is disposed");
  }
}

export const createSqliteAttemptStoreResource: AttemptStoreResourceFactory = (options) => {
  if (options.backend !== "sqlite") throw new Error("SQLite attempt-store factory requires sqlite options");
  const legacy = new SqliteMoneyActionStore(options.filename, { nonBlockingWrites: true });
  const persistence = new SqliteAttemptPersistence(options.filename, legacy);
  const kernel = new PersistentMoneyActionAttemptStore(legacy, persistence);
  const store = serializeSqliteStore(kernel);
  return { store, init: () => kernel.init(), dispose: () => kernel.dispose() };
};

function serializeSqliteStore(store: MoneyActionAttemptStore): MoneyActionAttemptStore {
  let gate = Promise.resolve();
  return new Proxy(store, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        let release!: () => void;
        const previous = gate;
        gate = new Promise<void>((resolve) => { release = resolve; });
        return previous.then(
          () => Reflect.apply(member, target, args),
          () => Reflect.apply(member, target, args),
        ).finally(release);
      };
    },
  }) as MoneyActionAttemptStore;
}

export const SQLITE_ATTEMPT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS money_action_attempt_states (
  action_id TEXT PRIMARY KEY REFERENCES money_action_operations(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  verified_execution_key TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS money_action_attempt_unique_verified_execution
ON money_action_attempt_states(verified_execution_key) WHERE verified_execution_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS money_action_attempt_evidence (
  evidence_key TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES money_action_operations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS money_action_attempt_evidence_action
ON money_action_attempt_evidence(action_id);
`;

export function isSqliteUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; errcode?: unknown };
  return String(value.code ?? "").startsWith("SQLITE_CONSTRAINT") ||
    value.errcode === 1555 ||
    value.errcode === 2067;
}

function isSqliteBusy(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "errcode" in error && (error as { errcode: unknown }).errcode === 5);
}
