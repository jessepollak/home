import "server-only";

import { createNeonSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import {
  isActionKind,
  type ActionKind,
  type MoneyActionCall,
  type MoneyActionOwner,
} from "@/shared/money-actions/types";
import type { AccountProvider } from "@/shared/account/session-types";
import type { CoinbaseSmartWalletTypedData, Address, Hex } from "@/shared/trading/server-types";

export type ActionSummary = {
  title: string;
  amounts: unknown[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
};

export type PendingAction = {
  calls: MoneyActionCall[];
  permit2Typed?: unknown;
  permitHash?: Hex;
  signingTypedData?: CoinbaseSmartWalletTypedData;
  signerAddress?: Address;
  signerOwnerIndex?: 0;
  signerDeployed?: boolean;
  swapCallIndex?: number;
};

export type ActionRow = {
  id: string;
  owner_key: string;
  provider: AccountProvider;
  kind: ActionKind;
  summary: ActionSummary;
  pending: PendingAction | null;
  created_at: string | Date;
  confirmed_at: string | Date | null;
  provider_handle: string | null;
  transaction_hash: string | null;
  handle_recorded_at: string | Date | null;
};

/**
 * Drivers disagree on jsonb: Neon's Pool returns parsed objects, Bun.SQL returns
 * the JSON text. Normalize at the query boundary so the store is driver-agnostic.
 */
function parseJsonColumn<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

type RawActionRow = Omit<ActionRow, "kind"> & { kind: unknown };

class InvalidStoredActionKindError extends Error {
  readonly code = "ACTION_KIND_UNSUPPORTED";

  constructor() {
    super("The stored action kind is unsupported.");
    this.name = "InvalidStoredActionKindError";
  }
}

function normalizeActionRow(row: RawActionRow): ActionRow {
  if (!isActionKind(row.kind)) throw new InvalidStoredActionKindError();
  return {
    ...row,
    kind: row.kind,
    summary: parseJsonColumn<ActionSummary>(row.summary) as ActionSummary,
    pending: parseJsonColumn<PendingAction>(row.pending),
  };
}

function normalizeActionRowOrNull(row: RawActionRow | undefined): ActionRow | null {
  if (!row) return null;
  try {
    return normalizeActionRow(row);
  } catch (error) {
    if (error instanceof InvalidStoredActionKindError) return null;
    throw error;
  }
}

let runtimeStore: ActionsStore | null = null;

export class ActionsStore {
  constructor(private readonly sql: SqlExecutor) {}

  async insert(input: {
    id: string;
    owner: MoneyActionOwner;
    kind: ActionKind;
    summary: ActionSummary;
    pending: PendingAction;
    createdAt: string;
  }): Promise<void> {
    await this.sql.query(
      `INSERT INTO actions (id, owner_key, provider, kind, summary, pending, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::timestamptz)`,
      [input.id, actionOwnerKey(input.owner), input.owner.accountProvider, input.kind,
        JSON.stringify(input.summary), JSON.stringify(input.pending), input.createdAt],
    );
  }

  async get(owner: MoneyActionOwner, id: string): Promise<ActionRow | null> {
    const result = await this.sql.query<RawActionRow>(
      `SELECT * FROM actions WHERE id = $1 AND owner_key = $2`,
      [id, actionOwnerKey(owner)],
    );
    return normalizeActionRowOrNull(result.rows[0]);
  }

  async confirm(owner: MoneyActionOwner, id: string, finalCalls?: MoneyActionCall[]): Promise<ActionRow | null> {
    return this.sql.transaction(async (tx) => {
      const selected = await tx.query<RawActionRow>(
        `SELECT * FROM actions WHERE id = $1 AND owner_key = $2 FOR UPDATE`,
        [id, actionOwnerKey(owner)],
      );
      const row = normalizeActionRowOrNull(selected.rows[0]);
      if (!row) return null;
      if (row.confirmed_at) return row;
      const updated = await tx.query<RawActionRow>(
        `UPDATE actions
         SET confirmed_at = now(),
             provider_handle = CASE WHEN provider = 'base-account' THEN id::text ELSE provider_handle END,
             pending = NULL
         WHERE id = $1 AND owner_key = $2
         RETURNING *`,
        [id, actionOwnerKey(owner)],
      );
      return {
        ...normalizeActionRow(updated.rows[0]!),
        pending: row.pending
          ? { ...row.pending, ...(finalCalls ? { calls: finalCalls } : {}) }
          : null,
      };
    });
  }

  async recordHandle(
    owner: MoneyActionOwner,
    id: string,
    input: { providerHandle?: string; transactionHash?: string },
  ): Promise<ActionRow | null> {
    const result = await this.sql.query<RawActionRow>(
      `UPDATE actions SET
         provider_handle = COALESCE(provider_handle, $3),
         transaction_hash = COALESCE(transaction_hash, $4),
         handle_recorded_at = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN now() ELSE handle_recorded_at END
       WHERE id = $1 AND owner_key = $2 AND confirmed_at IS NOT NULL
         AND (provider_handle IS NULL OR $3::text IS NULL OR provider_handle = $3)
         AND (transaction_hash IS NULL OR $4::text IS NULL OR LOWER(transaction_hash) = LOWER($4))
       RETURNING *`,
      [id, actionOwnerKey(owner), input.providerHandle ?? null, input.transactionHash ?? null],
    );
    return normalizeActionRowOrNull(result.rows[0]);
  }

  async list(owner: MoneyActionOwner): Promise<ActionRow[]> {
    const key = actionOwnerKey(owner);
    await this.sql.query(
      `DELETE FROM actions WHERE owner_key = $1 AND confirmed_at IS NULL AND created_at < now() - interval '1 hour'`,
      [key],
    );
    const result = await this.sql.query<RawActionRow>(
      `SELECT * FROM actions
       WHERE owner_key = $1 AND confirmed_at IS NOT NULL AND confirmed_at >= now() - interval '24 hours'
       ORDER BY confirmed_at DESC LIMIT 100`,
      [key],
      { timeoutMs: 5_000 },
    );
    return result.rows.flatMap((row) => {
      const normalized = normalizeActionRowOrNull(row);
      return normalized ? [normalized] : [];
    });
  }

  async dispose(): Promise<void> {
    await this.sql.dispose?.();
  }
}

export function actionOwnerKey(owner: MoneyActionOwner): string {
  return JSON.stringify([
    owner.subject,
    owner.address.toLowerCase(),
    8453,
    owner.accountProvider,
  ]);
}

export function getActionsStore(): ActionsStore {
  if (runtimeStore) return runtimeStore;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required for actions");
  runtimeStore = new ActionsStore(createNeonSqlExecutor(url));
  return runtimeStore;
}

export function setActionsStoreForTests(store: ActionsStore | null): void {
  runtimeStore = store;
}
