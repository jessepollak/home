import "server-only";

import type { IdrxMintResult } from "@/shared/funding/types";
import {
  createNeonSqlExecutor,
  type SqlExecutor,
} from "@/server/money-actions/postgres-sql";

export type IdrxAttemptOwner = {
  subject: string;
  smartAccount: `0x${string}`;
};

export type IdrxAttemptState =
  | { status: "new" }
  | { status: "pending" }
  | { status: "completed"; result: IdrxMintResult };

export type IdrxAttemptStore = {
  begin: (owner: IdrxAttemptOwner, attemptId: string) => Promise<IdrxAttemptState>;
  complete: (
    owner: IdrxAttemptOwner,
    attemptId: string,
    result: IdrxMintResult,
  ) => Promise<void>;
};

type AttemptRow = {
  subject: string;
  address: string;
  status: string;
  result_json: string | null;
};

const schema = `CREATE TABLE IF NOT EXISTS idrx_funding_attempts (
  attempt_id UUID PRIMARY KEY,
  subject TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export class PostgresIdrxAttemptStore implements IdrxAttemptStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly executor: SqlExecutor) {}

  async begin(owner: IdrxAttemptOwner, attemptId: string): Promise<IdrxAttemptState> {
    await this.ensureSchema();
    return this.executor.transaction(async (tx) => {
      const existing = await tx.query<AttemptRow>(
        "SELECT subject, address, status, result_json FROM idrx_funding_attempts WHERE attempt_id = $1 FOR UPDATE",
        [attemptId],
      );
      const row = existing.rows[0];
      if (row) return readAttempt(row, owner);
      const now = new Date().toISOString();
      await tx.query(
        "INSERT INTO idrx_funding_attempts (attempt_id, subject, address, status, created_at, updated_at) VALUES ($1, $2, $3, 'pending', $4, $5)",
        [attemptId, owner.subject, owner.smartAccount.toLowerCase(), now, now],
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
    this.schemaReady ??= this.executor.query(schema).then(() => undefined);
    await this.schemaReady;
  }
}

export class MemoryIdrxAttemptStore implements IdrxAttemptStore {
  private readonly values = new Map<string, AttemptRow>();

  async begin(owner: IdrxAttemptOwner, attemptId: string): Promise<IdrxAttemptState> {
    const row = this.values.get(attemptId);
    if (row) return readAttempt(row, owner);
    this.values.set(attemptId, {
      subject: owner.subject,
      address: owner.smartAccount.toLowerCase(),
      status: "pending",
      result_json: null,
    });
    return { status: "new" };
  }

  async complete(owner: IdrxAttemptOwner, attemptId: string, result: IdrxMintResult) {
    const row = this.values.get(attemptId);
    if (!row || readAttempt(row, owner).status !== "pending") {
      throw new Error("IDRX attempt completion conflict.");
    }
    this.values.set(attemptId, { ...row, status: "completed", result_json: JSON.stringify(result) });
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

function readAttempt(row: AttemptRow, owner: IdrxAttemptOwner): IdrxAttemptState {
  if (
    row.subject !== owner.subject ||
    row.address.toLowerCase() !== owner.smartAccount.toLowerCase()
  ) {
    return { status: "pending" };
  }
  if (row.status === "completed" && row.result_json) {
    return { status: "completed", result: JSON.parse(row.result_json) as IdrxMintResult };
  }
  return { status: "pending" };
}
