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

export type IdrxAttemptState =
  | { status: "new" }
  | { status: "mismatch" }
  | { status: "pending" }
  | { status: "completed"; result: IdrxMintResult };

export type IdrxAttemptStore = {
  begin: (
    owner: IdrxAttemptOwner,
    attemptId: string,
    intent: IdrxAttemptIntent,
  ) => Promise<IdrxAttemptState>;
  complete: (
    owner: IdrxAttemptOwner,
    attemptId: string,
    result: IdrxMintResult,
  ) => Promise<void>;
};

type AttemptRow = {
  attempt_id: string;
  subject: string;
  address: string;
  intent_json: string | null;
  status: string;
  result_json: string | null;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS idrx_funding_attempts (
    attempt_id UUID PRIMARY KEY,
    subject TEXT NOT NULL,
    address TEXT NOT NULL,
    intent_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "ALTER TABLE idrx_funding_attempts ADD COLUMN IF NOT EXISTS intent_json TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS idrx_funding_owner_unresolved ON idrx_funding_attempts (subject, address)",
] as const;

const selectColumns =
  "attempt_id, subject, address, intent_json, status, result_json";

export class PostgresIdrxAttemptStore implements IdrxAttemptStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly executor: SqlExecutor) {}

  async begin(
    owner: IdrxAttemptOwner,
    attemptId: string,
    intent: IdrxAttemptIntent,
  ): Promise<IdrxAttemptState> {
    await this.ensureSchema();
    return this.executor.transaction(async (tx) => {
      const byId = await tx.query<AttemptRow>(
        `SELECT ${selectColumns} FROM idrx_funding_attempts WHERE attempt_id = $1 FOR UPDATE`,
        [attemptId],
      );
      const exact = byId.rows[0];
      if (exact) return readAttempt(exact, owner, intent);

      const byOwner = await tx.query<AttemptRow>(
        `SELECT ${selectColumns} FROM idrx_funding_attempts WHERE subject = $1 AND address = $2 FOR UPDATE`,
        [owner.subject, owner.smartAccount.toLowerCase()],
      );
      const unresolved = byOwner.rows[0];
      if (unresolved) return sameIntent(unresolved.intent_json, intent)
        ? readAttempt(unresolved, owner, intent)
        : { status: "mismatch" };

      const now = new Date().toISOString();
      await tx.query(
        "INSERT INTO idrx_funding_attempts (attempt_id, subject, address, intent_json, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'pending', $5, $6)",
        [
          attemptId,
          owner.subject,
          owner.smartAccount.toLowerCase(),
          JSON.stringify(intent),
          now,
          now,
        ],
      );
      return { status: "new" };
    });
  }

  async complete(
    owner: IdrxAttemptOwner,
    attemptId: string,
    result: IdrxMintResult,
  ): Promise<void> {
    await this.ensureSchema();
    const updated = await this.executor.query(
      "UPDATE idrx_funding_attempts SET status = 'completed', result_json = $1, updated_at = $2 WHERE attempt_id = $3 AND subject = $4 AND address = $5 AND status = 'pending'",
      [
        JSON.stringify(result),
        new Date().toISOString(),
        attemptId,
        owner.subject,
        owner.smartAccount.toLowerCase(),
      ],
    );
    if (updated.rowCount !== 1) throw new Error("IDRX attempt completion conflict.");
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const statement of schemaStatements) await this.executor.query(statement);
    })();
    await this.schemaReady;
  }
}

export class MemoryIdrxAttemptStore implements IdrxAttemptStore {
  private readonly values = new Map<string, AttemptRow>();

  async begin(
    owner: IdrxAttemptOwner,
    attemptId: string,
    intent: IdrxAttemptIntent,
  ): Promise<IdrxAttemptState> {
    const exact = this.values.get(attemptId);
    if (exact) return readAttempt(exact, owner, intent);
    const unresolved = [...this.values.values()].find(
      (row) => row.subject === owner.subject &&
        row.address === owner.smartAccount.toLowerCase(),
    );
    if (unresolved) return sameIntent(unresolved.intent_json, intent)
      ? readAttempt(unresolved, owner, intent)
      : { status: "mismatch" };
    this.values.set(attemptId, {
      attempt_id: attemptId,
      subject: owner.subject,
      address: owner.smartAccount.toLowerCase(),
      intent_json: JSON.stringify(intent),
      status: "pending",
      result_json: null,
    });
    return { status: "new" };
  }

  async complete(owner: IdrxAttemptOwner, attemptId: string, result: IdrxMintResult) {
    const row = this.values.get(attemptId);
    if (!row || row.subject !== owner.subject ||
      row.address !== owner.smartAccount.toLowerCase() || row.status !== "pending") {
      throw new Error("IDRX attempt completion conflict.");
    }
    this.values.set(attemptId, {
      ...row,
      status: "completed",
      result_json: JSON.stringify(result),
    });
  }
}

export function createIdrxAttemptStore(
  databaseUrl = process.env.DATABASE_URL?.trim(),
): IdrxAttemptStore {
  if (!databaseUrl) {
    return {
      async begin() {
        throw new Error("DATABASE_URL is required for durable IDRX attempt persistence.");
      },
      async complete() {
        throw new Error("DATABASE_URL is required for durable IDRX attempt persistence.");
      },
    };
  }
  return new PostgresIdrxAttemptStore(createNeonSqlExecutor(databaseUrl));
}

function readAttempt(
  row: AttemptRow,
  owner: IdrxAttemptOwner,
  intent: IdrxAttemptIntent,
): IdrxAttemptState {
  if (
    row.subject !== owner.subject ||
    row.address.toLowerCase() !== owner.smartAccount.toLowerCase() ||
    !sameIntent(row.intent_json, intent)
  ) return { status: "mismatch" };
  if (row.status === "completed" && row.result_json) {
    return { status: "completed", result: JSON.parse(row.result_json) as IdrxMintResult };
  }
  return { status: "pending" };
}

function sameIntent(stored: string | null, expected: IdrxAttemptIntent): boolean {
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as Partial<IdrxAttemptIntent>;
    return parsed.toBeMinted === expected.toBeMinted &&
      parsed.rail === expected.rail &&
      (parsed.channelId ?? null) === expected.channelId &&
      parsed.customerSubject === expected.customerSubject &&
      parsed.customerName === expected.customerName;
  } catch {
    return false;
  }
}
