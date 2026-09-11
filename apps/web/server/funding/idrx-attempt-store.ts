import "server-only";

import type {
  IdrxFundingRail,
  IdrxMintResult,
  IdrxVaChannel,
} from "@/shared/funding/types";
import {
  createNeonSqlExecutor,
  type SqlExecutor,
} from "@/server/money-actions/postgres-sql";

export type IdrxAttemptOwner = {
  subject: string;
  smartAccount: `0x${string}`;
};

export type IdrxAttemptIntent = {
  toBeMinted: string;
  rail: IdrxFundingRail;
  channelId: IdrxVaChannel | null;
  customerSubject: string;
  customerName: string;
};

export type IdrxTerminalOutcome = "expired" | "failed" | "minted";
export type IdrxAttemptState =
  | { status: "none" }
  | { status: "new" }
  | { status: "mismatch" }
  | { status: "pending"; attemptId: string; intent: IdrxAttemptIntent }
  | { status: "completed"; attemptId: string; intent: IdrxAttemptIntent; result: IdrxMintResult }
  | { status: "terminal"; outcome: IdrxTerminalOutcome };

export type IdrxAttemptStore = {
  begin: (owner: IdrxAttemptOwner, attemptId: string, intent: IdrxAttemptIntent) => Promise<IdrxAttemptState>;
  recover: (owner: IdrxAttemptOwner) => Promise<IdrxAttemptState>;
  complete: (owner: IdrxAttemptOwner, attemptId: string, result: IdrxMintResult) => Promise<void>;
  release: (owner: IdrxAttemptOwner, attemptId: string, outcome: IdrxTerminalOutcome) => Promise<void>;
};

type AttemptRow = {
  attempt_id: string;
  subject: string;
  address: string;
  intent_json: string | null;
  status: string;
  result_json: string | null;
  released_at: string | null;
  terminal_outcome: string | null;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS idrx_funding_attempts (
    attempt_id UUID PRIMARY KEY,
    subject TEXT NOT NULL,
    address TEXT NOT NULL,
    intent_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    result_json TEXT,
    released_at TEXT,
    terminal_outcome TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "ALTER TABLE idrx_funding_attempts ADD COLUMN IF NOT EXISTS intent_json TEXT",
  "ALTER TABLE idrx_funding_attempts ADD COLUMN IF NOT EXISTS released_at TEXT",
  "ALTER TABLE idrx_funding_attempts ADD COLUMN IF NOT EXISTS terminal_outcome TEXT",
  "DROP INDEX IF EXISTS idrx_funding_owner_unresolved",
  "CREATE UNIQUE INDEX IF NOT EXISTS idrx_funding_owner_unresolved ON idrx_funding_attempts (subject, address) WHERE released_at IS NULL",
] as const;
const selectColumns = "attempt_id, subject, address, intent_json, status, result_json, released_at, terminal_outcome";

export class PostgresIdrxAttemptStore implements IdrxAttemptStore {
  private schemaReady: Promise<void> | null = null;
  constructor(private readonly executor: SqlExecutor) {}

  async begin(owner: IdrxAttemptOwner, attemptId: string, intent: IdrxAttemptIntent) {
    await this.ensureSchema();
    return this.executor.transaction(async (tx) => {
      const exact = (await tx.query<AttemptRow>(
        `SELECT ${selectColumns} FROM idrx_funding_attempts WHERE attempt_id = $1 FOR UPDATE`,
        [attemptId],
      )).rows[0];
      if (exact) return readAttempt(exact, owner, intent);
      const unresolved = (await tx.query<AttemptRow>(
        `SELECT ${selectColumns} FROM idrx_funding_attempts WHERE subject = $1 AND address = $2 AND released_at IS NULL FOR UPDATE`,
        [owner.subject, owner.smartAccount.toLowerCase()],
      )).rows[0];
      if (unresolved) return sameIntent(unresolved.intent_json, intent)
        ? readAttempt(unresolved, owner, intent)
        : { status: "mismatch" as const };
      const now = new Date().toISOString();
      await tx.query(
        "INSERT INTO idrx_funding_attempts (attempt_id, subject, address, intent_json, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'pending', $5, $6)",
        [attemptId, owner.subject, owner.smartAccount.toLowerCase(), JSON.stringify(intent), now, now],
      );
      return { status: "new" as const };
    });
  }

  async recover(owner: IdrxAttemptOwner) {
    await this.ensureSchema();
    const row = (await this.executor.query<AttemptRow>(
      `SELECT ${selectColumns} FROM idrx_funding_attempts WHERE subject = $1 AND address = $2 AND released_at IS NULL LIMIT 1`,
      [owner.subject, owner.smartAccount.toLowerCase()],
    )).rows[0];
    return row ? readOwnedAttempt(row) : { status: "none" as const };
  }

  async complete(owner: IdrxAttemptOwner, attemptId: string, result: IdrxMintResult) {
    await this.ensureSchema();
    const updated = await this.executor.query(
      "UPDATE idrx_funding_attempts SET status = 'completed', result_json = $1, updated_at = $2 WHERE attempt_id = $3 AND subject = $4 AND address = $5 AND status = 'pending' AND released_at IS NULL",
      [JSON.stringify(result), new Date().toISOString(), attemptId, owner.subject, owner.smartAccount.toLowerCase()],
    );
    if (updated.rowCount !== 1) throw new Error("IDRX attempt completion conflict.");
  }

  async release(owner: IdrxAttemptOwner, attemptId: string, outcome: IdrxTerminalOutcome) {
    await this.ensureSchema();
    const now = new Date().toISOString();
    const updated = await this.executor.query(
      "UPDATE idrx_funding_attempts SET released_at = $1, terminal_outcome = $2, updated_at = $3 WHERE attempt_id = $4 AND subject = $5 AND address = $6 AND released_at IS NULL",
      [now, outcome, now, attemptId, owner.subject, owner.smartAccount.toLowerCase()],
    );
    if (updated.rowCount !== 1) throw new Error("IDRX attempt release conflict.");
  }

  private async ensureSchema() {
    this.schemaReady ??= (async () => {
      for (const statement of schemaStatements) await this.executor.query(statement);
    })();
    await this.schemaReady;
  }
}

export class MemoryIdrxAttemptStore implements IdrxAttemptStore {
  private readonly values = new Map<string, AttemptRow>();

  async begin(owner: IdrxAttemptOwner, attemptId: string, intent: IdrxAttemptIntent) {
    const exact = this.values.get(attemptId);
    if (exact) return readAttempt(exact, owner, intent);
    const unresolved = [...this.values.values()].find((row) =>
      row.subject === owner.subject && row.address === owner.smartAccount.toLowerCase() && !row.released_at
    );
    if (unresolved) return sameIntent(unresolved.intent_json, intent)
      ? readAttempt(unresolved, owner, intent)
      : { status: "mismatch" as const };
    this.values.set(attemptId, rowFor(owner, attemptId, intent));
    return { status: "new" as const };
  }

  async recover(owner: IdrxAttemptOwner) {
    const row = [...this.values.values()].find((candidate) =>
      candidate.subject === owner.subject && candidate.address === owner.smartAccount.toLowerCase() && !candidate.released_at
    );
    return row ? readOwnedAttempt(row) : { status: "none" as const };
  }

  async complete(owner: IdrxAttemptOwner, attemptId: string, result: IdrxMintResult) {
    const row = this.values.get(attemptId);
    if (!row || !owns(row, owner) || row.status !== "pending" || row.released_at) throw new Error("IDRX attempt completion conflict.");
    this.values.set(attemptId, { ...row, status: "completed", result_json: JSON.stringify(result) });
  }

  async release(owner: IdrxAttemptOwner, attemptId: string, outcome: IdrxTerminalOutcome) {
    const row = this.values.get(attemptId);
    if (!row || !owns(row, owner) || row.released_at) throw new Error("IDRX attempt release conflict.");
    this.values.set(attemptId, { ...row, released_at: new Date().toISOString(), terminal_outcome: outcome });
  }
}

export function createIdrxAttemptStore(databaseUrl = process.env.DATABASE_URL?.trim()): IdrxAttemptStore {
  if (!databaseUrl) return unavailableStore();
  return new PostgresIdrxAttemptStore(createNeonSqlExecutor(databaseUrl));
}

function unavailableStore(): IdrxAttemptStore {
  const unavailable = async () => { throw new Error("DATABASE_URL is required for durable IDRX attempt persistence."); };
  return { begin: unavailable, recover: unavailable, complete: unavailable, release: unavailable };
}

function rowFor(owner: IdrxAttemptOwner, attemptId: string, intent: IdrxAttemptIntent): AttemptRow {
  return {
    attempt_id: attemptId,
    subject: owner.subject,
    address: owner.smartAccount.toLowerCase(),
    intent_json: JSON.stringify(intent),
    status: "pending",
    result_json: null,
    released_at: null,
    terminal_outcome: null,
  };
}

function readAttempt(row: AttemptRow, owner: IdrxAttemptOwner, intent: IdrxAttemptIntent): IdrxAttemptState {
  if (!owns(row, owner) || !sameIntent(row.intent_json, intent)) return { status: "mismatch" };
  if (row.released_at) return { status: "terminal", outcome: parseOutcome(row.terminal_outcome) };
  return readOwnedAttempt(row);
}

function readOwnedAttempt(row: AttemptRow): IdrxAttemptState {
  const intent = parseIntent(row.intent_json);
  if (!intent) return { status: "mismatch" };
  if (row.status === "completed" && row.result_json) {
    return { status: "completed", attemptId: row.attempt_id, intent, result: JSON.parse(row.result_json) as IdrxMintResult };
  }
  return { status: "pending", attemptId: row.attempt_id, intent };
}

function owns(row: AttemptRow, owner: IdrxAttemptOwner) {
  return row.subject === owner.subject && row.address.toLowerCase() === owner.smartAccount.toLowerCase();
}

function parseIntent(stored: string | null): IdrxAttemptIntent | null {
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as IdrxAttemptIntent;
    return value && typeof value.toBeMinted === "string" &&
      (value.rail === "bank-va" || value.rail === "qris") &&
      (value.channelId === null || value.channelId === "MANDIRI" || value.channelId === "BRI") &&
      typeof value.customerSubject === "string" && typeof value.customerName === "string" ? value : null;
  } catch { return null; }
}

function sameIntent(stored: string | null, expected: IdrxAttemptIntent) {
  const parsed = parseIntent(stored);
  return Boolean(parsed && parsed.toBeMinted === expected.toBeMinted && parsed.rail === expected.rail &&
    parsed.channelId === expected.channelId && parsed.customerSubject === expected.customerSubject && parsed.customerName === expected.customerName);
}

function parseOutcome(value: string | null): IdrxTerminalOutcome {
  return value === "minted" || value === "failed" ? value : "expired";
}
