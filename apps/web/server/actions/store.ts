import "server-only";

import { keccak256 } from "viem";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { getFundingProvider } from "@/server/funding/providers";
import { UNKNOWN_WINDOW_MS } from "@/server/funding/cash-out-window";
import {
  isActionKind,
  type ActionKind,
  type CashoutMoneyActionMetadata,
  type MoneyActionCall,
  type MoneyActionMetadata,
  type MoneyActionNetworkFee,
  type MoneyActionOwner,
} from "@/shared/money-actions/types";
import type { CashoutProgressState } from "@/shared/funding/contracts/cash-out-progress";
import type { AccountProvider } from "@/shared/account/session-types";
import type { CoinbaseSmartWalletTypedData, Address, Hex } from "@/shared/trading/server-types";
import type { TradeSigningRequest } from "@/shared/trading/contract";
import type { FundingMode } from "@/server/funding/core/provider-context";

export type ActionSummary = {
  title: string;
  amounts: unknown[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
  metadata?: MoneyActionMetadata;
  signing?: TradeSigningRequest;
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

export type CashoutOrderRow = {
  action_id: string;
  owner_key: string;
  provider_id: string;
  environment: "production" | "sandbox";
  region: string;
  deposit_id: string | null;
  deposit_proven: boolean;
  state: CashoutProgressState;
  platform: string;
  platform_label: string;
  amount_atomic: string;
  filled_atomic: string;
  returned_atomic: string;
  remaining_atomic: string;
  withdrawable: boolean;
  eta_seconds: number | null;
  created_at: string | Date;
  updated_at: string | Date;
  refreshed_at: string | Date | null;
  settled_at: string | Date | null;
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

function cashoutInsert(row: ActionRow): unknown[] | null {
  const metadata = row.summary.metadata;
  if (row.kind !== "cash-out" || metadata?.product !== "cashout" || metadata.operation !== "deposit") return null;
  const amount = row.summary.amounts.find((value): value is { assetId: string; direction: string; amountBaseUnits: string } =>
    typeof value === "object" && value !== null && "assetId" in value && "direction" in value && "amountBaseUnits" in value &&
    value.assetId === "usdc" && value.direction === "spend" && typeof value.amountBaseUnits === "string");
  if (!amount || !/^[1-9]\d*$/.test(amount.amountBaseUnits)) return null;
  const region = metadata.region ?? regionForCashout(metadata);
  if (!region) return null;
  return [row.id, row.owner_key, metadata.providerId, metadata.environment, region, metadata.platform,
    metadata.platformLabel, amount.amountBaseUnits, metadata.etaSeconds ?? null];
}

function regionForCashout(metadata: CashoutMoneyActionMetadata): string | null {
  const provider = getFundingProvider(metadata.providerId);
  return provider?.manifest.bindings.find((binding) => binding.currency === metadata.currency &&
    binding.directions.offramp?.paymentMethods.some((method) => method.id === metadata.platform))?.region ?? null;
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
             pending = CASE WHEN kind = 'trade' AND $4::jsonb IS NOT NULL THEN $4::jsonb ELSE NULL END,
             confirmed_call_data_hash = $3
         WHERE id = $1 AND owner_key = $2
         RETURNING *`,
        [id, actionOwnerKey(owner), callDataHash, row.kind === "trade" && confirmed ? JSON.stringify({ calls: confirmed }) : null],
      );
      const values = cashoutInsert(row);
      if (values) await tx.query(
        `INSERT INTO cashout_orders (action_id, owner_key, provider_id, environment, region, platform, platform_label, amount_atomic, remaining_atomic, eta_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9) ON CONFLICT DO NOTHING`,
        values,
      );
      return {
        ...normalizeActionRow(updated.rows[0]!),
        pending: row.pending && confirmed ? { ...row.pending, calls: confirmed } : null,
      };
    });
  }

  async ensureCashoutOrder(owner: MoneyActionOwner, row: ActionRow): Promise<CashoutOrderRow | null> {
    if (row.owner_key !== actionOwnerKey(owner) || !row.confirmed_at) return null;
    const values = cashoutInsert(row);
    if (!values) return null;
    await this.sql.query(
      `INSERT INTO cashout_orders (action_id, owner_key, provider_id, environment, region, platform, platform_label, amount_atomic, remaining_atomic, eta_seconds, created_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8, $9, confirmed_at
       FROM actions WHERE id = $1 AND owner_key = $2 AND confirmed_at IS NOT NULL
       ON CONFLICT DO NOTHING`, values,
    );
    return (await this.cashoutOrders(owner, [row.id]))[0] ?? null;
  }

  async cashoutOrders(owner: MoneyActionOwner, actionIds: readonly string[]): Promise<CashoutOrderRow[]> {
    if (actionIds.length === 0) return [];
    const result = await this.sql.query<CashoutOrderRow>(
      `SELECT * FROM cashout_orders WHERE owner_key = $1 AND action_id = ANY($2::uuid[])`,
      [actionOwnerKey(owner), [...actionIds]],
      { timeoutMs: 5_000 },
    );
    return result.rows;
  }

  async hasUnsettledCashout(owner: MoneyActionOwner): Promise<boolean> {
    const result = await this.sql.query<{ present: number }>(
      `SELECT 1 AS present FROM cashout_orders o
       JOIN actions a ON a.id = o.action_id AND a.owner_key = o.owner_key
       WHERE o.owner_key = $1 AND o.settled_at IS NULL
         AND (a.outcome IS DISTINCT FROM 'not_submitted' OR o.deposit_proven)
         AND (o.deposit_id IS NOT NULL OR (a.confirmed_at > now() - $2 * interval '1 millisecond' AND a.declined_reported_at IS NULL)
           OR a.provider_handle IS NOT NULL OR a.handle_recorded_at IS NOT NULL OR a.transaction_hash IS NOT NULL)
       LIMIT 1`,
      [actionOwnerKey(owner), UNKNOWN_WINDOW_MS], { timeoutMs: 5_000 },
    );
    return result.rows.length > 0;
  }

  async linkedCashoutDepositIds(owner: MoneyActionOwner, providerId: string): Promise<string[]> {
    const result = await this.sql.query<{ deposit_id: string }>(
      `SELECT LOWER(deposit_id) AS deposit_id FROM cashout_orders
       WHERE owner_key = $1 AND provider_id = $2 AND deposit_id IS NOT NULL`,
      [actionOwnerKey(owner), providerId],
      { timeoutMs: 5_000 },
    );
    return result.rows.map(({ deposit_id }) => deposit_id);
  }

  async claimCashoutRefresh(owner: MoneyActionOwner, actionId: string): Promise<void> {
    await this.sql.query(
      `UPDATE cashout_orders SET refreshed_at = now()
       WHERE owner_key = $1 AND action_id = $2 AND settled_at IS NULL`,
      [actionOwnerKey(owner), actionId],
    );
  }

  async linkCashoutDeposit(owner: MoneyActionOwner, actionId: string, depositId: string, proven = false): Promise<CashoutOrderRow | null> {
    return this.sql.transaction(async (tx) => {
      const key = actionOwnerKey(owner);
      const target = await tx.query<CashoutOrderRow>(
        `SELECT * FROM cashout_orders WHERE owner_key = $1 AND action_id = $2 AND settled_at IS NULL AND deposit_id IS NULL FOR UPDATE`,
        [key, actionId],
      );
      const record = target.rows[0];
      if (!record) return null;
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext(lower($2)))`, [record.provider_id, depositId]);
      const existing = await tx.query<Pick<CashoutOrderRow, "action_id" | "owner_key" | "deposit_proven">>(
        `SELECT action_id, owner_key, deposit_proven FROM cashout_orders
         WHERE provider_id = $1 AND lower(deposit_id) = lower($2) FOR UPDATE`,
        [record.provider_id, depositId],
      );
      const linked = existing.rows[0];
      if (linked && (!proven || linked.owner_key !== key || linked.deposit_proven)) return null;
      if (linked) {
        await tx.query(
          `UPDATE cashout_orders SET deposit_id = NULL, deposit_proven = false, state = 'submitted',
             filled_atomic = '0', returned_atomic = '0', remaining_atomic = amount_atomic,
             withdrawable = false, settled_at = NULL, updated_at = now()
           WHERE action_id = $1 AND owner_key = $2 AND provider_id = $3 AND lower(deposit_id) = lower($4) AND deposit_proven = false`,
          [linked.action_id, key, record.provider_id, depositId],
        );
      }
      const result = await tx.query<CashoutOrderRow>(
        `UPDATE cashout_orders SET deposit_id = $3, deposit_proven = $4, updated_at = now()
         WHERE owner_key = $1 AND action_id = $2 AND settled_at IS NULL AND deposit_id IS NULL RETURNING *`,
        [key, actionId, depositId, proven],
      );
      return result.rows[0] ?? null;
    });
  }

  async updateCashoutProgress(owner: MoneyActionOwner, actionId: string, update: {
    state: CashoutProgressState;
    filledAtomic: string;
    returnedAtomic: string;
    remainingAtomic: string;
    withdrawable: boolean;
    settled: boolean;
  }): Promise<CashoutOrderRow | null> {
    const result = await this.sql.query<CashoutOrderRow>(
      `UPDATE cashout_orders SET state = $3, filled_atomic = $4, returned_atomic = $5,
         remaining_atomic = $6, withdrawable = $7, settled_at = CASE WHEN $8 THEN now() ELSE NULL END, updated_at = now()
       WHERE owner_key = $1 AND action_id = $2 AND settled_at IS NULL RETURNING *`,
      [actionOwnerKey(owner), actionId, update.state, update.filledAtomic, update.returnedAtomic,
        update.remainingAtomic, update.withdrawable, update.settled],
    );
    return result.rows[0] ?? null;
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
         pending = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN NULL ELSE pending END,
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
      `UPDATE actions SET outcome = $3, outcome_source = $4, settled_at = $5, pending = NULL,
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
      `SELECT * FROM (
         SELECT * FROM actions
         WHERE owner_key = $1 AND confirmed_at IS NOT NULL
           AND (declined_reported_at IS NULL OR provider_handle IS NOT NULL OR transaction_hash IS NOT NULL OR outcome IS NOT NULL)
           AND (
           confirmed_at >= now() - interval '24 hours' OR
           (kind IN ('cash-out', 'cash-out-withdraw') AND confirmed_at >= now() - interval '30 days') OR
           (kind = 'cash-out' AND (
             EXISTS (SELECT 1 FROM cashout_orders WHERE action_id = actions.id AND owner_key = $1 AND settled_at IS NULL) OR
             NOT EXISTS (SELECT 1 FROM cashout_orders WHERE action_id = actions.id)
           )) OR
           (kind = 'cash-out-withdraw' AND summary->'metadata'->>'product' = 'cashout'
             AND summary->'metadata'->>'operation' = 'withdraw'
             AND EXISTS (SELECT 1 FROM cashout_orders
               WHERE owner_key = $1 AND settled_at IS NULL AND deposit_id IS NOT NULL
                 AND LOWER(deposit_id) = LOWER(actions.summary->'metadata'->>'depositId'))))
         ORDER BY ((kind = 'cash-out' AND (
           EXISTS (SELECT 1 FROM cashout_orders WHERE action_id = actions.id AND owner_key = $1 AND settled_at IS NULL) OR
           NOT EXISTS (SELECT 1 FROM cashout_orders WHERE action_id = actions.id)
         )) OR (kind = 'cash-out-withdraw' AND summary->'metadata'->>'product' = 'cashout'
           AND summary->'metadata'->>'operation' = 'withdraw'
           AND EXISTS (SELECT 1 FROM cashout_orders
             WHERE owner_key = $1 AND settled_at IS NULL AND deposit_id IS NOT NULL
               AND LOWER(deposit_id) = LOWER(actions.summary->'metadata'->>'depositId')))) DESC NULLS LAST,
           confirmed_at DESC LIMIT 100
       ) ranked ORDER BY confirmed_at DESC`,
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
