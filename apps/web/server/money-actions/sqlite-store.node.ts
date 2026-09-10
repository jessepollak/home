import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/features/money-actions/types";
import { canTransitionMoneyActionStatus } from "./status-transitions.js";
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

  constructor(path = defaultDatabasePath()) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
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
    this.database.exec("BEGIN IMMEDIATE");
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
    this.database.exec("BEGIN IMMEDIATE");
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
    this.database.exec("BEGIN IMMEDIATE");
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
    this.database.exec("BEGIN IMMEDIATE");
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
    this.database.exec("BEGIN IMMEDIATE");
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
