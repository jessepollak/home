import "server-only";

import { parseAddress } from "@/shared/chain/hex";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS } from "@/shared/account/contracts/data-export";
import { parseAccountDeletionReceipt, type AccountDeletionBlocker, type AccountDeletionProvider, type AccountDeletionReceipt } from "@/shared/account/contracts/account-deletion";
import { financialEvidenceExpiresAt } from "@/shared/account/financial-retention";
import { readDatabaseUrl } from "@/server/config/env";
import { lockWalletAddress } from "@/server/customers/wallet-lock";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { resolveExportOwner, type ExportScope } from "@/server/account-export/owner";
import { accountActionScope } from "@/server/account-export/action-scope";
import { AccountExportError } from "@/server/account-export/errors";
import { mapJsonFields } from "@/server/account-export/safe-fields";
import { deriveActionStatus } from "@/server/actions/status";
import { ACTION_DRAFT_RETENTION_MS, actionOwnerKey, actionReviewExpired, NON_DECLINED_ACTION_SQL, type ActionOutcome } from "@/server/actions/store";
import { UNRECONCILED_CARD_EVENT_SQL } from "@/server/cards/transaction-store";
import { getFundingProvider } from "@/server/funding/providers";
import { OPEN_FUNDING_ORDER_SQL } from "@/server/funding/core/postgres-store";
import { AccountDeletionError } from "./errors";
import { credentialDigest, findTombstone, lockCredential, requireTombstoneKey, tombstoneKeyId } from "./tombstone";
import { deletionReceipt, heldByProvider, type DeletionRequestRow } from "./receipt";

function actionScope(scope: ExportScope) {
  try { return accountActionScope(scope); }
  catch { throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE"); }
}
function fundingScope(table: string): string {
  const keys = table === "funding_provider_user_tokens" ? ["account_provider", "owner_subject", "provider_id", "region", "sandbox"] : ["id"];
  const columns = keys.join(",");
  return `(${keys.map((column) => `${table}.${column}`).join(",")}) IN (
    SELECT ${columns} FROM ${table} WHERE customer_id=$1
    UNION ALL
    SELECT ${keys.map((column) => `f.${column}`).join(",")} FROM customer_credentials cr
    JOIN ${table} f ON f.account_provider=cr.account_provider AND f.owner_subject=cr.subject
    WHERE cr.customer_id=$1 AND f.customer_id IS NULL)`;
}

export class AccountDeletionStore {
  constructor(private readonly sql: SqlExecutor, private readonly now: () => Date = () => new Date()) {}

  async read(session: VerifiedAccountSession, create: boolean, signal?: AbortSignal): Promise<AccountDeletionReceipt> {
    const deadline = AbortSignal.timeout(25_000);
    const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const key = requireTombstoneKey();
    const row = await this.sql.transaction(async (tx) => {
      await tx.query("SET LOCAL lock_timeout='22s'; SET LOCAL statement_timeout='25s'");
      const customerId = await this.customerForSession(tx, session, operationSignal);
      if (customerId) await this.lockCustomer(tx, customerId, operationSignal);
      const lockedExisting = customerId ? await this.queuedRequest(tx, customerId, operationSignal) : undefined;
      await lockCredential(tx, credentialDigest(key, session.accountProvider, session.user.subject));
      if (create) {
        const tombstone = await findTombstone(tx, session, this.now(), key);
        if (tombstone) return this.request(tx, tombstone.request_id);
      }
      const live = await tx.query("SELECT 1 FROM customer_credentials WHERE account_provider=$1 AND subject=$2", [session.accountProvider, session.user.subject], { signal: operationSignal });
      if (!live.rowCount) {
        const recovery = await findTombstone(tx, session, this.now(), key, false);
        if (recovery) return this.request(tx, recovery.request_id);
        if (!create) throw new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND");
      }
      const scope = await this.scope(tx, session, operationSignal);
      if (scope.customerId !== customerId) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
      if (create) {
        const inserted = (await tx.query<DeletionRequestRow>(
          `INSERT INTO account_deletion_requests(customer_id,session_owner_keys) VALUES ($1,$2::text[])
           ON CONFLICT (customer_id) WHERE status='queued' DO NOTHING RETURNING *`,
          [scope.customerId, this.sessionOwnerKeys(session)], { signal: operationSignal },
        )).rows[0];
        const existing = inserted ?? (await tx.query<DeletionRequestRow>("SELECT * FROM account_deletion_requests WHERE customer_id=$1 AND status='queued'", [scope.customerId], { signal: operationSignal })).rows[0];
        return this.saveSessionOwnerKeys(tx, existing.id, session, operationSignal);
      }
      const existing = lockedExisting;
      if (!existing) throw new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND");
      return this.saveSessionOwnerKeys(tx, existing.id, session, operationSignal);
    }, { signal: operationSignal });
    if (!row) throw new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND");
    if (row.status === "completed") return this.receipt(row);
    return this.attempt(row.id, session, signal, deadline);
  }

  async attempt(id: string, session?: VerifiedAccountSession, signal?: AbortSignal, operationDeadline?: AbortSignal): Promise<AccountDeletionReceipt> {
    const key = requireTombstoneKey();
    const deadline = operationDeadline ? AbortSignal.any([operationDeadline, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      return await this.sql.transaction(async (tx) => {
        await tx.query("SET LOCAL lock_timeout='22s'; SET LOCAL statement_timeout='20s'; SET LOCAL idle_in_transaction_session_timeout='20s'");
        const settings = await tx.query("SELECT 1 FROM pg_settings WHERE name='transaction_timeout'");
        if (settings.rowCount) await tx.query("SET LOCAL transaction_timeout='20s'");
        const initial = await this.request(tx, id);
        if (initial.status === "completed") return this.receipt(initial);
        if (!initial.customer_id) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        await this.lockCustomer(tx, initial.customer_id, boundedSignal);
        const row = await this.request(tx, id, true);
        if (row.status === "completed") return this.receipt(row);
        if (!row.customer_id || row.customer_id !== initial.customer_id) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        const owner = session ?? await this.sessionForCustomer(tx, row.customer_id);
        let scope = await this.scope(tx, owner, boundedSignal);
        if (scope.customerId !== row.customer_id) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        for (const digest of scope.credentials.map((credential) => credentialDigest(key, credential.account_provider, credential.subject)).sort()) await lockCredential(tx, digest);
        scope = await this.scope(tx, owner, boundedSignal);
        if (scope.customerId !== row.customer_id) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        scope.ownerKeys = [...new Set([...scope.ownerKeys, ...(row.session_owner_keys ?? []), ...(session ? this.sessionOwnerKeys(session) : [])])];
        const actions = actionScope(scope);
        if ((await tx.query(`SELECT id FROM actions WHERE ${actions.ownerSql} AND customer_id IS NOT NULL AND customer_id<>$1 LIMIT 1`, actions.values)).rowCount) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        const legacyAddresses = await this.legacyAddresses(tx, scope);
        await tx.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [scope.customerId]);
        await tx.query("SELECT customer_id FROM card_accounts WHERE customer_id=$1 ORDER BY mode FOR UPDATE", [scope.customerId]);
        await tx.query("SELECT id FROM cards WHERE customer_id=$1 ORDER BY id FOR UPDATE", [scope.customerId]);
        await tx.query(`SELECT id FROM actions WHERE ${actions.sql} ORDER BY id FOR UPDATE`, actions.values, { signal: boundedSignal });
        await tx.query(`SELECT id FROM funding_orders WHERE ${fundingScope("funding_orders")} ORDER BY id FOR UPDATE`, [scope.customerId], { signal: boundedSignal });
        await tx.query(`SELECT action_id FROM cashout_orders WHERE action_id IN (SELECT id FROM actions WHERE ${actions.sql}) ORDER BY action_id FOR UPDATE`, actions.values, { signal: boundedSignal });
        const blockers = await this.blockers(tx, scope, boundedSignal);
        const at = this.now();
        if (blockers.length) {
          const blocked = (await tx.query<DeletionRequestRow>(
            "UPDATE account_deletion_requests SET blockers=$2::jsonb,last_attempt_at=$3,last_attempt_outcome='blocked',updated_at=$3 WHERE id=$1 RETURNING *",
            [id, JSON.stringify(blockers), at], { signal: boundedSignal },
          )).rows[0];
          return deletionReceipt(blocked);
        }
        const providers = await this.providers(tx, scope);
        const expiresAt = financialEvidenceExpiresAt(at);
        const pseudonym = crypto.randomUUID();
        await tx.query("INSERT INTO customers(id,status,first_seen_at,last_seen_at,first_seen_source,retained_until) VALUES ($1,'closed',$2,$2,'backfill',$3)", [pseudonym, at, expiresAt]);
        await this.retain(tx, scope, pseudonym);
        await tx.query("INSERT INTO account_deletion_audit_expiry(target_id,expires_at) VALUES ($1,$2)", [scope.customerId, expiresAt]);
        for (const credential of scope.credentials) {
          await tx.query(
            `INSERT INTO account_deletion_tombstones(credential_digest,key_id,request_id,completed_at,expires_at) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (credential_digest) DO UPDATE SET key_id=EXCLUDED.key_id,request_id=EXCLUDED.request_id,completed_at=EXCLUDED.completed_at,expires_at=EXCLUDED.expires_at`,
            [credentialDigest(key, credential.account_provider, credential.subject), tombstoneKeyId(key), id, at, expiresAt],
          );
        }
        const receipt = deletionReceipt(row, providers, at);
        await tx.query("UPDATE account_deletion_requests SET customer_id=NULL,session_owner_keys=NULL,status='completed',completed_at=$2,updated_at=$2,expires_at=$3,blockers='[]'::jsonb,receipt=$4::jsonb WHERE id=$1", [id, at, expiresAt, JSON.stringify(receipt)]);
        await this.remove(tx, scope, legacyAddresses);
        if (boundedSignal.aborted) throw boundedSignal.reason;
        return receipt;
      }, { signal: boundedSignal });
    } catch (error) {
      const failed = await this.sql.transaction(async (tx) => {
        await tx.query("SET LOCAL statement_timeout='3s'");
        const row = await this.request(tx, id);
        if (row.status === "completed") return this.receipt(row);
        if (!row.customer_id) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        await this.lockCustomer(tx, row.customer_id);
        const updated = (await tx.query<DeletionRequestRow>("UPDATE account_deletion_requests SET last_attempt_at=$2,last_attempt_outcome='failed',updated_at=$2 WHERE id=$1 AND status='queued' AND customer_id=$3 RETURNING *", [id, this.now(), row.customer_id])).rows[0];
        return updated ? deletionReceipt(updated) : this.receipt(await this.request(tx, id));
      }, { signal: AbortSignal.timeout(3_000) });
      if (error instanceof AccountDeletionError && error.code === "ACCOUNT_DELETION_LINKAGE") throw error;
      if (deadline.aborted && !signal?.aborted) return failed;
      throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
    }
  }

  private async customerForSession(tx: SqlExecutor, session: VerifiedAccountSession, signal?: AbortSignal): Promise<string | null> {
    return (await tx.query<{ customer_id: string }>("SELECT customer_id FROM customer_credentials WHERE account_provider=$1 AND subject=$2", [session.accountProvider, session.user.subject], { signal })).rows[0]?.customer_id ?? null;
  }

  private async lockCustomer(tx: SqlExecutor, customerId: string, signal?: AbortSignal): Promise<void> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0)) AS locked", [`home.account-deletion.customer.v1:${customerId}`], { signal });
  }

  private async queuedRequest(tx: SqlExecutor, customerId: string, signal?: AbortSignal): Promise<DeletionRequestRow | undefined> {
    return (await tx.query<DeletionRequestRow>("SELECT * FROM account_deletion_requests WHERE customer_id=$1 AND status='queued' FOR UPDATE", [customerId], { signal })).rows[0];
  }

  private async saveSessionOwnerKeys(tx: SqlExecutor, id: string, session: VerifiedAccountSession, signal?: AbortSignal): Promise<DeletionRequestRow> {
    return (await tx.query<DeletionRequestRow>("UPDATE account_deletion_requests SET session_owner_keys=ARRAY(SELECT DISTINCT unnest(COALESCE(session_owner_keys,ARRAY[]::text[]) || $2::text[])) WHERE id=$1 AND status='queued' RETURNING *", [id, this.sessionOwnerKeys(session)], { signal })).rows[0];
  }

  private sessionOwnerKeys(session: VerifiedAccountSession): string[] {
    return session.smartAccount ? [actionOwnerKey({ accountProvider: session.accountProvider, subject: session.user.subject, chainId: 8453, address: session.smartAccount.address })] : [];
  }

  private async scope(tx: SqlExecutor, session: VerifiedAccountSession, signal?: AbortSignal): Promise<ExportScope> {
    try { return await resolveExportOwner(tx, session, ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS, signal); }
    catch (error) {
      if (error instanceof AccountExportError && error.code === "ACCOUNT_EXPORT_LINKAGE") throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
      throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
    }
  }

  private async request(tx: SqlExecutor, id: string, lock = false): Promise<DeletionRequestRow> {
    const row = (await tx.query<DeletionRequestRow>(`SELECT * FROM account_deletion_requests WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
    if (!row) throw new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND");
    return row;
  }

  private receipt(row: DeletionRequestRow): AccountDeletionReceipt {
    const receipt = parseAccountDeletionReceipt(row.receipt);
    if (!receipt) throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
    return receipt;
  }

  private async sessionForCustomer(tx: SqlExecutor, customerId: string): Promise<VerifiedAccountSession> {
    const credential = (await tx.query<{ account_provider: VerifiedAccountSession["accountProvider"]; subject: string }>("SELECT account_provider,subject FROM customer_credentials WHERE customer_id=$1 ORDER BY id LIMIT 1", [customerId])).rows[0];
    if (!credential) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
    return { accountProvider: credential.account_provider, user: { subject: credential.subject }, smartAccount: null };
  }

  private async blockers(tx: SqlExecutor, scope: ExportScope, signal: AbortSignal): Promise<AccountDeletionBlocker[]> {
    const scoped = actionScope(scope);
    const values = scoped.values;
    const now = this.now();
    const actions = (await tx.query<{ confirmed_at: Date | null; declined_reported_at: Date | null; created_at: Date; handle_recorded_at: Date | null; provider_handle: string | null; transaction_hash: string | null; outcome: ActionOutcome | null; summary: { expiresAt?: string } }>(
      `SELECT confirmed_at,created_at,declined_reported_at,handle_recorded_at,provider_handle,transaction_hash,outcome,summary FROM actions a WHERE ${scoped.sql}`, values, { signal },
    )).rows;
    const actionCount = actions.filter((row) => {
      if ((!row.confirmed_at || row.declined_reported_at) && !row.handle_recorded_at && !row.provider_handle && !row.transaction_hash && !row.outcome &&
        ((!row.confirmed_at && row.created_at.getTime() < now.getTime() - ACTION_DRAFT_RETENTION_MS) ||
          (typeof row.summary.expiresAt === "string" && actionReviewExpired(row.summary.expiresAt, now)))) return false;
      const status = deriveActionStatus({ confirmedAt: (row.confirmed_at ?? row.created_at).toISOString(), submittedAt: row.handle_recorded_at?.toISOString(), transactionHash: row.transaction_hash, outcome: row.outcome, receipt: null, now });
      return status !== "confirmed" && status !== "failed";
    }).length;
    const count = async (text: string, parameters: unknown[]) => Number((await tx.query<{ count: string }>(text, parameters, { signal })).rows[0].count);
    const counts: AccountDeletionBlocker[] = [
      { name: "actions", count: actionCount },
      { name: "funding_orders", count: await count(`SELECT count(*) FROM funding_orders WHERE ${fundingScope("funding_orders")} AND (${OPEN_FUNDING_ORDER_SQL})`, [scope.customerId]) },
      { name: "cashout_orders", count: await count(`SELECT count(*) FROM cashout_orders WHERE action_id IN (SELECT id FROM actions WHERE ${scoped.sql}) AND NOT (deposit_id IS NULL AND NOT deposit_proven AND EXISTS (SELECT 1 FROM actions a WHERE a.id=cashout_orders.action_id AND (a.outcome='not_submitted' OR NOT ${NON_DECLINED_ACTION_SQL}))) AND (settled_at IS NULL OR state NOT IN ('delivered','failed','returned'))`, values) },
      { name: "card_transactions", count: await count(`SELECT count(*) FROM (SELECT t.id::text FROM cards c JOIN card_transactions t ON t.card_id=c.id WHERE c.customer_id=$1 AND t.status='pending' AND NOT (t.kind='authorization' AND t.authorization_closed IS TRUE) UNION ALL SELECT e.event_id FROM cards c JOIN card_events e ON e.card_id=c.stripe_card_id AND e.mode=c.mode LEFT JOIN card_transactions t ON t.card_id=c.id AND t.provider='bridge' AND t.mode=e.mode AND t.provider_transaction_id=e.transaction_id WHERE c.customer_id=$1 AND ${UNRECONCILED_CARD_EVENT_SQL}) pending`, [scope.customerId]) },
    ];
    return counts.filter((entry) => entry.count > 0);
  }

  private async providers(tx: SqlExecutor, scope: ExportScope): Promise<AccountDeletionProvider[]> {
    const providers = new Map<string, AccountDeletionProvider>();
    for (const credential of scope.credentials) {
      const label = credential.account_provider === "base-account" ? "Base Account" : "Coinbase";
      providers.set(`signin:${label}`, heldByProvider(label, "Sign-in and wallet records"));
    }
    const funding = (await tx.query<{ provider_id: string }>(
      ["funding_orders", "funding_provider_customers", "funding_provider_user_tokens"].map((table) => `SELECT provider_id FROM ${table} WHERE ${fundingScope(table)}`).join(" UNION "), [scope.customerId],
    )).rows;
    for (const row of funding) {
      const label = getFundingProvider(row.provider_id)?.manifest.displayName;
      if (!label) throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
      providers.set(`funding:${label}`, heldByProvider(label, "Funding and verification records"));
    }
    if ((await tx.query("SELECT 1 FROM card_accounts WHERE customer_id=$1 LIMIT 1", [scope.customerId])).rowCount) {
      providers.set("card:Bridge", heldByProvider("Bridge", "Card account, verification and active provider cards"));
      providers.set("card:Stripe", heldByProvider("Stripe", "Card and purchase records"));
    }
    return [...providers.values()];
  }

  private async retain(tx: SqlExecutor, scope: ExportScope, pseudonym: string): Promise<void> {
    const scoped = actionScope(scope);
    const actions = (await tx.query<{ id: string; summary: unknown }>(`SELECT id,summary FROM actions WHERE ${scoped.sql} FOR UPDATE`, scoped.values)).rows;
    const actionIds = actions.map((row) => row.id);
    for (const row of actions) {
      const summary = mapJsonFields("actions", { summary: row.summary }).summary;
      await tx.query("UPDATE actions SET customer_id=$2,credential_id=NULL,wallet_id=NULL,owner_key=$3,pending=NULL,account_address=NULL,summary=$4::jsonb WHERE id=$1", [row.id, pseudonym, `retained:${pseudonym}`, JSON.stringify(summary)]);
    }
    await tx.query("UPDATE cashout_orders SET owner_key=$2 WHERE action_id=ANY($1::uuid[])", [actionIds, `retained:${pseudonym}`]);
    const funding = (await tx.query<{ id: string; quote: unknown; fees: unknown }>(`SELECT id,quote,fees FROM funding_orders WHERE ${fundingScope("funding_orders")} FOR UPDATE`, [scope.customerId])).rows;
    for (const row of funding) {
      const clean = mapJsonFields("funding_orders", row);
      await tx.query("UPDATE funding_orders SET customer_id=$2,credential_id=NULL,wallet_id=NULL,owner_subject=$3,destination=NULL,customer_ref=NULL,quote_token=NULL,intent_digest=NULL,instructions=NULL,quote=$4::jsonb,fees=$5::jsonb WHERE id=$1", [row.id, pseudonym, `retained:${pseudonym}`, JSON.stringify(clean.quote), JSON.stringify(clean.fees)]);
    }
    await tx.query("INSERT INTO card_accounts(customer_id,mode,created_at,updated_at) SELECT $2,mode,created_at,updated_at FROM card_accounts WHERE customer_id=$1", [scope.customerId, pseudonym]);
    await tx.query("UPDATE card_transactions SET merchant_name=NULL,merchant_category=NULL WHERE card_id IN (SELECT id FROM cards WHERE customer_id=$1)", [scope.customerId]);
    await tx.query(`DELETE FROM card_events WHERE (provider,mode,event_id) IN (
      SELECT e.provider,e.mode,e.event_id FROM card_accounts ca JOIN card_events e
        ON e.provider='bridge' AND e.mode=ca.mode AND e.customer_id=ca.bridge_customer_id WHERE ca.customer_id=$1
      UNION ALL
      SELECT e.provider,e.mode,e.event_id FROM card_accounts ca JOIN card_events e
        ON e.provider='bridge' AND e.mode=ca.mode AND e.cardholder_account_id=ca.stripe_cardholder_id WHERE ca.customer_id=$1
      UNION ALL
      SELECT e.provider,e.mode,e.event_id FROM cards c JOIN card_events e
        ON e.provider='bridge' AND e.mode=c.mode AND e.card_id=c.stripe_card_id WHERE c.customer_id=$1)`, [scope.customerId]);
    await tx.query("UPDATE cards SET customer_id=$2,wallet_address=NULL WHERE customer_id=$1", [scope.customerId, pseudonym]);
    await tx.query("DELETE FROM card_accounts WHERE customer_id=$1", [scope.customerId]);
  }

  private async legacyAddresses(tx: SqlExecutor, scope: ExportScope): Promise<string[]> {
    const scoped = actionScope(scope);
    const rows = (await tx.query<{ account_address: string | null; owner_key: string }>(`SELECT account_address,owner_key FROM actions WHERE customer_id IS NULL AND ${scoped.sql}`, scoped.values)).rows;
    const addresses = new Set<string>();
    for (const row of rows) {
      let owner: unknown;
      try { owner = JSON.parse(row.owner_key); }
      catch { throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE"); }
      if (!Array.isArray(owner) || owner.length !== 4 || owner[2] !== 8453 ||
          !scope.credentials.some((credential) => credential.subject === owner[0] && credential.account_provider === owner[3])) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
      for (const address of [owner[1], row.account_address]) {
        if (address === null) continue;
        const parsed = parseAddress(address);
        if (!parsed) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
        addresses.add(parsed);
      }
    }
    const sorted = [...addresses].sort();
    for (const address of sorted) await lockWalletAddress(tx, 8453, address);
    const enrolled = (await tx.query<{ address: string }>("SELECT address FROM customer_wallets WHERE chain_id=8453 AND address=ANY($2::text[]) AND customer_id<>$1", [scope.customerId, sorted])).rows;
    const otherOwned = new Set(enrolled.map((row) => row.address));
    return sorted.filter((address) => !otherOwned.has(address));
  }

  private async remove(tx: SqlExecutor, scope: ExportScope, legacyAddresses: string[]): Promise<void> {
    for (const table of ["funding_provider_user_tokens", "funding_provider_customers"]) await tx.query(`DELETE FROM ${table} WHERE ${fundingScope(table)}`, [scope.customerId]);
    await tx.query("DELETE FROM customer_email_requests e USING customer_credentials cr WHERE cr.customer_id=$1 AND e.account_provider=cr.account_provider AND e.subject=cr.subject", [scope.customerId]);
    for (const table of ["balance_snapshots", "history_addresses"]) await tx.query(`DELETE FROM ${table} s USING customer_wallets w WHERE w.customer_id=$1 AND s.chain_id=w.chain_id AND s.address=w.address AND NOT EXISTS (SELECT 1 FROM customer_wallets other WHERE other.chain_id=s.chain_id AND other.address=s.address AND other.customer_id<>$1)`, [scope.customerId]);
    for (const table of ["balance_snapshots", "history_addresses"]) await tx.query(`DELETE FROM ${table} s WHERE s.chain_id=8453 AND s.address=ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM customer_wallets other WHERE other.chain_id=s.chain_id AND other.address=s.address AND other.customer_id<>$2)`, [legacyAddresses, scope.customerId]);
    const merged = await tx.query("SELECT c.id FROM customers c WHERE c.merged_into=$1 AND (EXISTS (SELECT 1 FROM customer_credentials cr WHERE cr.customer_id=c.id) OR EXISTS (SELECT 1 FROM customer_wallets w WHERE w.customer_id=c.id)) LIMIT 1", [scope.customerId]);
    if (merged.rowCount) throw new AccountDeletionError("ACCOUNT_DELETION_LINKAGE");
    await tx.query("DELETE FROM customers WHERE merged_into=$1", [scope.customerId]);
    await tx.query("UPDATE customers SET invite_code=NULL WHERE invite_code IN (SELECT code FROM invite_codes WHERE customer_id=$1::uuid)", [scope.customerId]);
    await tx.query(`UPDATE operator_events SET props = props - array_remove(ARRAY[CASE WHEN props->>'inviteCode' IN (SELECT code FROM invite_codes WHERE customer_id=$1::uuid) THEN 'inviteCode' ELSE NULL END, CASE WHEN props->>'inviterCustomerId'=$1::text THEN 'inviterCustomerId' ELSE NULL END],NULL)
      WHERE (props ? 'inviterCustomerId' AND props->>'inviterCustomerId'=$1::text) OR (props ? 'inviteCode' AND props->>'inviteCode' IN (SELECT code FROM invite_codes WHERE customer_id=$1::uuid))`, [scope.customerId]);
    await tx.query("DELETE FROM customers WHERE id=$1", [scope.customerId]);
  }
}

export async function readAccountDeletion(session: VerifiedAccountSession, create: boolean, signal?: AbortSignal): Promise<AccountDeletionReceipt> {
  if (!readDatabaseUrl()) throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
  return new AccountDeletionStore(getSqlExecutor()).read(session, create, signal);
}
