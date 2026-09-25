import "server-only";

import { keccak256 } from "viem";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import {
  isActionKind,
  type ActionKind,
  type MoneyActionCall,
  type MoneyActionMetadata,
  type MoneyActionNetworkFee,
  type MoneyActionOwner,
} from "@/shared/money-actions/types";
import type { AccountProvider } from "@/shared/account/session-types";
import type { CoinbaseSmartWalletTypedData, Address, Hex } from "@/shared/trading/server-types";
import type { FundingMode } from "@/server/funding/core/provider-context";

export type ActionSummary = {
  title: string;
  amounts: unknown[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
  metadata?: MoneyActionMetadata;
  networkFee?: MoneyActionNetworkFee;
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

export type ActionOutcome = "succeeded" | "reverted" | "not_submitted";

export type ActionRow = {
  id: string;
  owner_key: string;
  account_address: string | null;
  provider: AccountProvider;
  kind: ActionKind;
  summary: ActionSummary;
  pending: PendingAction | null;
  created_at: string | Date;
  confirmed_at: string | Date | null;
  confirmed_call_data_hash?: string | null;
  provider_handle: string | null;
  transaction_hash: string | null;
  handle_recorded_at: string | Date | null;
  declined_reported_at: string | Date | null;
  dispatch_attempt: number;
  outcome: ActionOutcome | null;
  outcome_source: "chain" | "wallet" | null;
  settled_at: string | Date | null;
  outcome_recorded_at: string | Date | null;
};

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
      `INSERT INTO actions (id, owner_key, account_address, provider, kind, summary, pending, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)`,
      [input.id, actionOwnerKey(input.owner), input.owner.address.toLowerCase(), input.owner.accountProvider, input.kind,
        JSON.stringify(input.summary), JSON.stringify(input.pending), input.createdAt],
    );
  }

  async getForPaymaster(id: string): Promise<Pick<ActionRow, "owner_key" | "summary" | "created_at" | "confirmed_at" | "confirmed_call_data_hash"> | null> {
    const result = await this.sql.query<{ owner_key: string; summary: ActionSummary | string; created_at: string | Date; confirmed_at: string | Date | null; confirmed_call_data_hash: string | null }>(
      `SELECT owner_key, summary, created_at, confirmed_at, confirmed_call_data_hash FROM actions WHERE id = $1`,
      [id],
      { timeoutMs: 5_000 },
    );
    const row = result.rows[0];
    return row ? { ...row, summary: parseJsonColumn<ActionSummary>(row.summary) as ActionSummary } : null;
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
      const confirmed = row.pending ? finalCalls ?? row.pending.calls : null;
      const callDataHash = confirmed ? keccak256(encodeCoinbaseExecuteBatch(confirmed)).toLowerCase() : null;
      const updated = await tx.query<RawActionRow>(
        `UPDATE actions
         SET confirmed_at = now(),
             pending = NULL,
             confirmed_call_data_hash = $3
         WHERE id = $1 AND owner_key = $2
         RETURNING *`,
        [id, actionOwnerKey(owner), callDataHash],
      );
      return {
        ...normalizeActionRow(updated.rows[0]!),
        pending: row.pending && confirmed ? { ...row.pending, calls: confirmed } : null,
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
         handle_recorded_at = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN COALESCE(handle_recorded_at, now()) ELSE handle_recorded_at END
       WHERE id = $1 AND owner_key = $2 AND confirmed_at IS NOT NULL
         AND (provider_handle IS NULL OR $3::text IS NULL OR provider_handle = $3)
         AND (transaction_hash IS NULL OR $4::text IS NULL OR LOWER(transaction_hash) = LOWER($4))
         AND ($4::text IS NULL OR transaction_hash IS NOT NULL OR outcome_source IS DISTINCT FROM 'wallet')
       RETURNING *`,
      [id, actionOwnerKey(owner), input.providerHandle ?? null, input.transactionHash ?? null],
    );
    return normalizeActionRowOrNull(result.rows[0]);
  }

  async beginRetry(owner: MoneyActionOwner, id: string, attempt: number): Promise<{ row: ActionRow | null; conflict: boolean; dispatched: boolean }> {
    const result = await this.sql.query<RawActionRow>(
      `UPDATE actions SET dispatch_attempt = $3, declined_reported_at = NULL
       WHERE id = $1 AND owner_key = $2 AND confirmed_at IS NOT NULL
         AND dispatch_attempt = $3 - 1 AND outcome IS NULL
         AND provider_handle IS NULL AND transaction_hash IS NULL RETURNING *`,
      [id, actionOwnerKey(owner), attempt],
    );
    if (result.rows[0]) return { row: normalizeActionRow(result.rows[0]), conflict: false, dispatched: false };
    const row = await this.get(owner, id);
    if (!row?.confirmed_at) return { row: null, conflict: false, dispatched: false };
    if (row.dispatch_attempt >= attempt) return { row, conflict: false, dispatched: false };
    if (row.provider_handle || row.transaction_hash || row.outcome) return { row, conflict: true, dispatched: true };
    return { row, conflict: true, dispatched: false };
  }

  async recordDecline(owner: MoneyActionOwner, id: string, attempt: number): Promise<{ row: ActionRow | null; changed: boolean }> {
    const result = await this.sql.query<RawActionRow>(
      `UPDATE actions SET declined_reported_at = now()
       WHERE id = $1 AND owner_key = $2 AND confirmed_at IS NOT NULL
         AND declined_reported_at IS NULL AND provider_handle IS NULL
         AND transaction_hash IS NULL AND outcome IS NULL
         AND dispatch_attempt = $3 RETURNING *`,
      [id, actionOwnerKey(owner), attempt],
    );
    if (result.rows[0]) return { row: normalizeActionRow(result.rows[0]), changed: true };
    const row = await this.get(owner, id);
    return { row: row?.confirmed_at ? row : null, changed: false };
  }

  async recordOutcome(
    owner: MoneyActionOwner,
    id: string,
    input: { outcome: ActionOutcome; source: "chain" | "wallet"; settledAt: Date | null },
  ): Promise<{ row: ActionRow | null; written: boolean; conflict: boolean }> {
    const result = await this.sql.query<RawActionRow>(
      `UPDATE actions SET outcome = $3, outcome_source = $4, settled_at = $5,
         outcome_recorded_at = now()
       WHERE id = $1 AND owner_key = $2 AND confirmed_at IS NOT NULL AND outcome IS NULL
         AND ($4 <> 'wallet' OR transaction_hash IS NULL) RETURNING *`,
      [id, actionOwnerKey(owner), input.outcome, input.source, input.settledAt],
    );
    if (result.rows[0]) return { row: normalizeActionRow(result.rows[0]), written: true, conflict: false };
    const row = await this.get(owner, id);
    return { row, written: false, conflict: Boolean(row && (
      row.outcome != null && row.outcome !== input.outcome || input.source === "wallet" && row.transaction_hash != null
    )) };
  }

  async hasCashoutHistory(owner: MoneyActionOwner): Promise<boolean> {
    const result = await this.sql.query<{ present: number }>(
      `SELECT 1 AS present FROM actions
       WHERE owner_key = $1 AND confirmed_at IS NOT NULL
         AND kind IN ('cash-out', 'cash-out-withdraw')
       LIMIT 1`,
      [actionOwnerKey(owner)],
      { timeoutMs: 5_000 },
    );
    return result.rows.length > 0;
  }

  async cashoutRecoveryModes(owner: MoneyActionOwner): Promise<FundingMode[]> {
    const result = await this.sql.query<{ environment: unknown }>(
      `SELECT DISTINCT summary->'metadata'->>'environment' AS environment
       FROM actions
       WHERE owner_key = $1 AND confirmed_at IS NOT NULL
         AND kind IN ('cash-out', 'cash-out-withdraw')`,
      [actionOwnerKey(owner)],
      { timeoutMs: 5_000 },
    );
    return result.rows.flatMap(({ environment }) =>
      environment === "production" || environment === "sandbox" ? [environment] : [],
    );
  }

  async listDispatchedSends(owner: MoneyActionOwner, limit: number): Promise<ActionRow[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("The dispatched send limit must be between 1 and 100.");
    }
    const result = await this.sql.query<RawActionRow>(
      `SELECT * FROM actions
       WHERE owner_key = $1 AND kind = 'send' AND confirmed_at IS NOT NULL
         AND (provider_handle IS NOT NULL OR transaction_hash IS NOT NULL OR handle_recorded_at IS NOT NULL)
       ORDER BY confirmed_at DESC LIMIT $2`,
      [actionOwnerKey(owner), limit],
      { timeoutMs: 5_000 },
    );
    return result.rows.flatMap((row) => {
      const normalized = normalizeActionRowOrNull(row);
      return normalized ? [normalized] : [];
    });
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
         AND (declined_reported_at IS NULL OR provider_handle IS NOT NULL OR transaction_hash IS NOT NULL OR outcome IS NOT NULL)
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
  runtimeStore = new ActionsStore(createPostgresSqlExecutor(url));
  return runtimeStore;
}

/** @public exercised by server/actions/prepare.test.ts */
export function setActionsStoreForTests(store: ActionsStore | null): void {
  runtimeStore = store;
}
