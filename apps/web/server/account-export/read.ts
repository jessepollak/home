import "server-only";

import { ACCOUNT_EXPORT_HOME_CLASSES, ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS, ACCOUNT_EXPORT_SCHEMA, ACCOUNT_EXPORT_VERSION, parseAccountExportResponse, type AccountExportHomeClass, type AccountExportRecord, type AccountExportResponse, type AccountExportValue } from "@/shared/account/contracts/data-export";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { AccountExportError } from "./errors";
import { resolveExportOwner } from "./owner";
import { mapJsonFields } from "./safe-fields";

export async function readAccountExport(session: VerifiedAccountSession, signal?: AbortSignal): Promise<AccountExportResponse> {
  if (!readDatabaseUrl()) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
  return new AccountExportReader(getSqlExecutor()).read(session, signal);
}

export class AccountExportReader {
  constructor(private readonly sql: SqlExecutor, private readonly cap = ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS) {
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > ACCOUNT_EXPORT_MAX_RECORDS_PER_CLASS) throw new RangeError("Invalid export limit");
  }

  async read(session: VerifiedAccountSession, signal?: AbortSignal): Promise<AccountExportResponse> {
    const result = await this.sql.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY", [], { signal });
      await tx.query("SET LOCAL statement_timeout = '10s'", [], { signal });
      const scope = await resolveExportOwner(tx, session, this.cap, signal);
      const classes = new Map<AccountExportHomeClass, AccountExportRecord[]>();
      const addRows = (name: AccountExportHomeClass, rows: Record<string, unknown>[]) => {
        if (rows.length > this.cap) throw new AccountExportError("ACCOUNT_EXPORT_TOO_LARGE");
        classes.set(name, rows.map((row) => record(mapJsonFields(name, row))));
        return rows;
      };
      const read = async (name: AccountExportHomeClass, text: string, values: unknown[]) => addRows(name,
        (await tx.query(`${text} LIMIT $${values.length + 1}`, [...values, this.cap + 1], { signal })).rows);
      const id = scope.customerId;
      await read("customer", "SELECT id,status,country,invite_code,first_seen_at,last_seen_at,first_seen_source,created_at FROM customers WHERE id=$1", [id]);
      addRows("credentials", scope.credentials);
      addRows("wallets", scope.wallets);
      await read("preferences", "SELECT country_preference,created_at,updated_at FROM customer_preferences WHERE customer_id=$1", [id]);
      await read("invites", "SELECT code,created_at FROM invite_codes WHERE customer_id=$1", [id]);
      await read("email_requests", `SELECT e.account_provider,e.subject,e.asked_at,e.answer,e.answer_channel,e.sign_in_capability,e.wallet_code,e.wallet_message,e.bundle_id,e.created_at,e.updated_at
        FROM customer_email_requests e JOIN customer_credentials cr ON cr.account_provider=e.account_provider AND cr.subject=e.subject WHERE cr.customer_id=$1`, [id]);
      await read("operator_events", "SELECT name,occurred_at,source,sandbox FROM operator_events WHERE customer_id=$1", [id]);
      await read("access_audit", "SELECT occurred_at,action,purpose FROM admin_audit_log WHERE target_kind='customer' AND target_id=$1", [id]);
      const actions = await read("actions", `SELECT id,account_address,provider,kind,summary,created_at,confirmed_at,transaction_hash,handle_recorded_at,declined_reported_at,dispatch_attempt,outcome,outcome_source,settled_at,outcome_recorded_at,
        observed_receipt_transaction_hash,observed_receipt_block_number::text,observed_receipt_block_hash,observed_receipt_outcome,observed_at
        FROM actions WHERE customer_id=$1 OR (customer_id IS NULL AND owner_key=ANY($2::text[]))`, [id, scope.ownerKeys]);
      const actionIds = actions.map((row) => row.id);
      await read("cashout_orders", `SELECT action_id,provider_id,environment,region,deposit_id,deposit_proven,state,platform,platform_label,amount_atomic,filled_atomic,returned_atomic,remaining_atomic,withdrawable,eta_seconds,created_at,updated_at,refreshed_at,settled_at,provider_updated_at
        FROM cashout_orders WHERE action_id=ANY($1::uuid[])`, [actionIds]);
      await read("operator_fees", `SELECT id::text,action_id,action_kind,amount_base_units::text,token_asset_id,token_address,token_decimals,bps,recipient,collected_by,recorded_at
        FROM operator_fee_records WHERE action_id=ANY($1::uuid[])`, [actionIds]);
      const funding = async (name: AccountExportHomeClass, table: string, columns: string) => read(name,
        `(SELECT ${columns} FROM ${table} WHERE customer_id=$1 LIMIT $2)
         UNION ALL
         (SELECT ${columns.split(",").map((column) => `f.${column}`).join(",")} FROM customer_credentials cr
          JOIN ${table} f ON f.account_provider=cr.account_provider AND f.owner_subject=cr.subject
          WHERE cr.customer_id=$1 AND f.customer_id IS NULL LIMIT $2)`, [id, this.cap + 1]);
      const fundingOrders = await funding("funding_orders", "funding_orders", "id,destination,provider_id,region,asset_id,payment_method,fiat_amount,quote,state,creation_block::text,provider_order_id,expected_token_amount_atomic,fees,expires_at,provider_status,provider_transaction_hash,transaction_hash,log_index::text,version,sandbox,created_at,updated_at,abandon_reason,checked_at");
      await funding("funding_provider_customers", "funding_provider_customers", "id,provider_id,region,state,verification_started_at,created_at,updated_at");
      await funding("funding_provider_credentials", "funding_provider_user_tokens", "provider_id,region,sandbox,returned_at,updated_at");
      await read("balance_snapshots", `SELECT s.chain_id,s.address,s.block_number::text,s.block_timestamp::text,s.observed_at,s.holdings,s.coverage,s.borrow
        FROM customer_wallets w JOIN balance_snapshots s ON s.chain_id=w.chain_id AND s.address=w.address WHERE w.customer_id=$1`, [id]);
      const history = await read("balance_history_addresses", `SELECT h.id,h.chain_id,h.address,h.window_start_block::text,h.window_start_at,h.enrolled_block::text,h.backfill_block::text,h.forward_block::text,h.dirty_at,h.ingested_at,h.created_at
        FROM customer_wallets w JOIN history_addresses h ON h.chain_id=w.chain_id AND h.address=w.address WHERE w.customer_id=$1`, [id]);
      const historyIds = history.map((row) => row.id);
      await read("balance_changes", `SELECT address_id,asset_id,block_number::text,log_index::text,block_time,CASE WHEN tx_hash IS NULL THEN NULL ELSE '0x'||encode(tx_hash,'hex') END AS transaction_hash,delta::text,source
        FROM balance_changes WHERE address_id=ANY($1::integer[])`, [historyIds]);
      await read("balance_checkpoints", `SELECT address_id,asset_id,block_number::text,purpose,chain_quantity::text,log_quantity::text,observed_at
        FROM balance_checkpoints WHERE address_id=ANY($1::integer[])`, [historyIds]);
      await read("card_accounts", "SELECT mode,created_at,updated_at FROM card_accounts WHERE customer_id=$1", [id]);
      await read("cards", "SELECT id,mode,stripe_card_id,wallet_address,created_at FROM cards WHERE customer_id=$1", [id]);
      await read("card_events", `SELECT provider,mode,event_id,kind,card_id,transaction_id,occurred_at,received_at FROM (
        (SELECT e.provider,e.mode,e.event_id,e.kind,e.card_id,e.transaction_id,e.occurred_at,e.received_at
         FROM card_accounts ca JOIN card_events e ON e.provider='bridge' AND e.mode=ca.mode AND e.customer_id=ca.bridge_customer_id
         WHERE ca.customer_id=$1 LIMIT $2)
        UNION
        (SELECT e.provider,e.mode,e.event_id,e.kind,e.card_id,e.transaction_id,e.occurred_at,e.received_at
         FROM cards c JOIN card_events e ON e.provider='bridge' AND e.mode=c.mode AND e.card_id=c.stripe_card_id
         WHERE c.customer_id=$1 LIMIT $2)
      ) owned_events`, [id, this.cap + 1]);
      await read("card_transactions", `SELECT t.id,t.card_id,t.provider,t.mode,t.provider_transaction_id,t.authorization_id,t.kind,t.amount_minor::text,t.currency,t.merchant_name,t.merchant_category,t.status,t.decline_reason_code,t.provider_created_at,t.updated_at
        FROM cards c JOIN card_transactions t ON t.card_id=c.id WHERE c.customer_id=$1`, [id]);
      const conversations = await read("support_conversations", `SELECT id,status,handler,handed_off_at,created_at,updated_at,last_message_at,last_customer_message_at,last_operator_message_at,customer_read_at,resolved_at
        FROM support_conversations WHERE customer_id=$1`, [id]);
      const conversationIds = conversations.map((row) => row.id);
      await read("support_messages", `SELECT id,conversation_id,author_type,status,body,created_at FROM support_messages
        WHERE conversation_id=ANY($1::uuid[]) AND status='sent'`, [conversationIds]);
      await read("support_assistant_runs", `SELECT r.id,r.conversation_id,r.message_id,r.started_at,r.replay
        FROM support_assistant_runs r JOIN support_messages m ON m.id=r.message_id AND m.conversation_id=r.conversation_id
        WHERE r.conversation_id=ANY($1::uuid[]) AND m.status='sent'`, [conversationIds]);
      await read("support_context_refs", `SELECT id,conversation_id,kind,ref_id,created_at FROM support_context_refs
        WHERE conversation_id=ANY($1::uuid[]) AND
        ((kind='money_action' AND ref_id=ANY($2::text[])) OR (kind='funding_order' AND ref_id=ANY($3::text[])))`, [conversationIds, actionIds, fundingOrders.map((row) => row.id)]);
      if (signal?.aborted) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
      const response: AccountExportResponse = {
        version: ACCOUNT_EXPORT_VERSION, schema: ACCOUNT_EXPORT_SCHEMA, generatedAt: new Date().toISOString(), complete: true,
        classes: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => ({ name, holder: "home", records: classes.get(name) ?? [] })),
        boundaries: {
          providerHeld: "Records held by account, wallet, funding, card and other providers are not included. Home does not hold copies of provider documents.",
          publicChain: "Onchain history is public on Base. Home cannot erase it.",
          currentDevice: "Browser preferences are listed only for the device that made this export.",
        },
      };
      if (!parseAccountExportResponse(response)) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
      return response;
    });
    if (signal?.aborted) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
    return result;
  }
}

function record(row: Record<string, unknown>): AccountExportRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), wireValue(value)]));
}

function wireValue(value: unknown): AccountExportValue {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(wireValue);
  if (isObject(value)) return record(value);
  throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
