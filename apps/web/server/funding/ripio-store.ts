import "server-only";

import type { SqlExecutor } from "@/server/money-actions/postgres-sql";
import {
  reconcileRipioOrder,
  transactionMatchesOrder,
  type DurableRipioOrder,
  type PendingRipioInbox,
  type RipioInboxRecord,
  type RipioReconciliationStore,
  type RipioVerifiedObservation,
} from "./ripio-reconciliation";

export const RIPIO_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS ripio_customers (
  home_customer_key TEXT PRIMARY KEY,
  country TEXT NOT NULL CHECK (country IN ('AR', 'CO')),
  provider_customer_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ripio_orders (
  home_order_id TEXT PRIMARY KEY,
  home_customer_key TEXT NOT NULL REFERENCES ripio_customers(home_customer_key),
  country TEXT NOT NULL CHECK (country IN ('AR', 'CO')),
  provider_customer_id TEXT NOT NULL,
  provider_quote_id TEXT NOT NULL,
  provider_order_id TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type = 'ON_RAMP'),
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain = 'BASE'),
  payment_method_type TEXT NOT NULL,
  destination TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_decimals INTEGER NOT NULL CHECK (token_decimals = 18),
  expected_amount_atomic TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_status TEXT NOT NULL,
  provider_transaction_hash TEXT,
  latest_refund_status TEXT,
  latest_refund_rejection_reason TEXT,
  transfer_evidence_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ripio_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider_order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  raw_body_digest TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ripio_webhook_inbox (
  event_id TEXT PRIMARY KEY REFERENCES ripio_webhook_events(event_id),
  provider_order_id TEXT NOT NULL,
  recovery_state TEXT NOT NULL CHECK (recovery_state IN ('pending-recovery', 'reconciled', 'rejected')),
  country TEXT,
  provider_status TEXT,
  latest_refund_status TEXT,
  latest_refund_rejection_reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ripio_orders_customer_recent ON ripio_orders (home_customer_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS ripio_inbox_pending ON ripio_webhook_inbox (recovery_state, updated_at);`;

export const ripioSchemaStatements = RIPIO_SCHEMA_SQL.split(";").map((value) => value.trim()).filter(Boolean);

export class PostgresRipioStore implements RipioReconciliationStore {
  private initialized: Promise<void> | null = null;
  constructor(private readonly sql: SqlExecutor, private readonly now: () => string = () => new Date().toISOString()) {}

  async ensureSchema(): Promise<void> {
    this.initialized ??= (async () => { for (const statement of ripioSchemaStatements) await this.sql.query(statement); })();
    return this.initialized;
  }

  async putCustomer(input: { homeCustomerKey: string; country: "AR" | "CO"; providerCustomerId: string }): Promise<void> {
    await this.ensureSchema();
    const now = this.now();
    const result = await this.sql.query(
      `INSERT INTO ripio_customers (home_customer_key, country, provider_customer_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$4) ON CONFLICT (home_customer_key) DO UPDATE SET updated_at=EXCLUDED.updated_at
       WHERE ripio_customers.country=EXCLUDED.country AND ripio_customers.provider_customer_id=EXCLUDED.provider_customer_id
       RETURNING home_customer_key`,
      [input.homeCustomerKey, input.country, input.providerCustomerId, now],
    );
    if (result.rowCount !== 1) throw new Error("ripio-customer-binding-conflict");
  }

  async putOrder(order: DurableRipioOrder): Promise<void> {
    await this.ensureSchema();
    await this.sql.query(
      `INSERT INTO ripio_orders (home_order_id,home_customer_key,country,provider_customer_id,provider_quote_id,provider_order_id,
       operation_type,from_currency,to_currency,chain,payment_method_type,destination,token_address,token_decimals,
       expected_amount_atomic,state,provider_status,provider_transaction_hash,latest_refund_status,latest_refund_rejection_reason,
       transfer_evidence_json,version,updated_at) VALUES (${Array.from({ length: 23 }, (_, index) => `$${index + 1}`).join(",")})`,
      orderValues(order),
    );
  }

  async hasWebhookEvent(eventId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.sql.query(`SELECT event_id FROM ripio_webhook_events WHERE event_id=$1`, [eventId]);
    return result.rowCount > 0;
  }

  async recordUnmatchedWebhook(record: RipioInboxRecord): Promise<boolean> {
    await this.ensureSchema();
    return this.sql.transaction(async (tx) => {
      const inserted = await insertEvent(tx, record.event, record.rawBodyDigest, record.recordedAt);
      if (!inserted) return false;
      await tx.query(
        `INSERT INTO ripio_webhook_inbox (event_id,provider_order_id,recovery_state,updated_at) VALUES ($1,$2,$3,$4)`,
        [record.event.eventId, record.event.providerOrderId, record.state, record.recordedAt],
      );
      return true;
    });
  }

  async getByProviderOrderId(providerOrderId: string): Promise<DurableRipioOrder | null> {
    await this.ensureSchema();
    const result = await this.sql.query<RipioOrderRow>(`SELECT * FROM ripio_orders WHERE provider_order_id=$1`, [providerOrderId]);
    return result.rows[0] ? rowToOrder(result.rows[0]) : null;
  }

  async applyVerifiedObservation(observation: RipioVerifiedObservation): Promise<"applied" | "duplicate" | "unmatched" | "binding-conflict"> {
    await this.ensureSchema();
    return this.sql.transaction(async (tx) => {
      const duplicate = await tx.query(`SELECT event_id FROM ripio_webhook_events WHERE event_id=$1 FOR UPDATE`, [observation.event.eventId]);
      const result = await tx.query<RipioOrderRow>(`SELECT * FROM ripio_orders WHERE provider_order_id=$1 FOR UPDATE`, [observation.event.providerOrderId]);
      const row = result.rows[0];
      if (!row) return "unmatched";
      const current = rowToOrder(row);
      if (!transactionMatchesOrder(current, observation.transaction)) return "binding-conflict";
      const reconciled = reconcileRipioOrder({ order: current, transaction: observation.transaction, transferEvidence: observation.transferEvidence, now: observation.observedAt });
      if (duplicate.rowCount === 0) {
        const inserted = await insertEvent(tx, observation.event, observation.rawBodyDigest, observation.observedAt);
        if (!inserted) return "duplicate";
      }
      await updateOrder(tx, current, reconciled);
      return duplicate.rowCount > 0 ? "duplicate" : "applied";
    });
  }

  async listPendingInbox(limit: number): Promise<PendingRipioInbox[]> {
    await this.ensureSchema();
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = await this.sql.query<{ event_id: string; provider_order_id: string }>(
      `SELECT event_id,provider_order_id FROM ripio_webhook_inbox WHERE recovery_state='pending-recovery' ORDER BY updated_at LIMIT $1`,
      [bounded],
    );
    return result.rows.map((row) => ({ eventId: row.event_id, providerOrderId: row.provider_order_id }));
  }

  async resolveInbox(input: { eventId: string; country: "AR" | "CO"; transaction: import("./ripio-client").RipioTransactionReference; resolvedAt: string }): Promise<"applied" | "pending" | "binding-conflict"> {
    await this.ensureSchema();
    return this.sql.transaction(async (tx) => {
      const inbox = await tx.query<{ provider_order_id: string }>(
        `SELECT provider_order_id FROM ripio_webhook_inbox WHERE event_id=$1 AND recovery_state='pending-recovery' FOR UPDATE`,
        [input.eventId],
      );
      const providerOrderId = inbox.rows[0]?.provider_order_id;
      if (!providerOrderId) return "pending";
      const result = await tx.query<RipioOrderRow>(`SELECT * FROM ripio_orders WHERE provider_order_id=$1 FOR UPDATE`, [providerOrderId]);
      const row = result.rows[0];
      if (!row) return "pending";
      const current = rowToOrder(row);
      if (current.country !== input.country || !transactionMatchesOrder(current, input.transaction)) return "binding-conflict";
      const reconciled = reconcileRipioOrder({ order: current, transaction: input.transaction, now: input.resolvedAt });
      await updateOrder(tx, current, reconciled);
      await tx.query(
        `UPDATE ripio_webhook_inbox SET recovery_state='reconciled',country=$1,provider_status=$2,latest_refund_status=$3,
         latest_refund_rejection_reason=$4,updated_at=$5 WHERE event_id=$6 AND recovery_state='pending-recovery'`,
        [input.country,input.transaction.status,input.transaction.latestRefund?.status ?? null,input.transaction.latestRefund?.rejectionReason ?? null,input.resolvedAt,input.eventId],
      );
      return "applied";
    });
  }
}

async function updateOrder(tx: SqlExecutor, current: DurableRipioOrder, reconciled: DurableRipioOrder): Promise<void> {
  const updated = await tx.query(
    `UPDATE ripio_orders SET state=$1,provider_status=$2,provider_transaction_hash=$3,latest_refund_status=$4,
     latest_refund_rejection_reason=$5,transfer_evidence_json=$6,version=$7,updated_at=$8
     WHERE home_order_id=$9 AND provider_order_id=$10 AND version=$11 RETURNING home_order_id`,
    [reconciled.state,reconciled.providerStatus,reconciled.providerTransactionHash,reconciled.latestRefundStatus,
     reconciled.latestRefundRejectionReason,reconciled.transferEvidence ? JSON.stringify(reconciled.transferEvidence) : null,
     reconciled.version,reconciled.updatedAt,reconciled.homeOrderId,reconciled.providerOrderId,current.version],
  );
  if (updated.rowCount !== 1) throw new Error("ripio-order-version-conflict");
}

async function insertEvent(tx: SqlExecutor, event: RipioInboxRecord["event"], digest: string, recordedAt: string): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO ripio_webhook_events (event_id,provider_order_id,status,occurred_at,raw_body_digest,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [event.eventId,event.providerOrderId,event.status,event.occurredAt,digest,recordedAt],
  );
  return result.rowCount === 1;
}

type RipioOrderRow = {
  home_order_id:string; home_customer_key:string; country:"AR"|"CO"; provider_customer_id:string; provider_quote_id:string;
  provider_order_id:string; operation_type:"ON_RAMP"; from_currency:"ARS"|"COP"; to_currency:"wARS"|"wCOP"; chain:"BASE";
  payment_method_type:string; destination:`0x${string}`; token_address:`0x${string}`; token_decimals:18; expected_amount_atomic:string;
  state:DurableRipioOrder["state"]; provider_status:string; provider_transaction_hash:`0x${string}`|null; latest_refund_status:string|null;
  latest_refund_rejection_reason:string|null; transfer_evidence_json:string|null; version:number; updated_at:string;
};
function orderValues(o: DurableRipioOrder): unknown[] { return [o.homeOrderId,o.homeCustomerKey,o.country,o.customerId,o.quoteId,o.providerOrderId,o.operationType,o.fromCurrency,o.toCurrency,o.chain,o.paymentMethodType,o.destination,o.tokenAddress,o.tokenDecimals,o.expectedAmountAtomic,o.state,o.providerStatus,o.providerTransactionHash,o.latestRefundStatus,o.latestRefundRejectionReason,o.transferEvidence ? JSON.stringify(o.transferEvidence) : null,o.version,o.updatedAt]; }
function rowToOrder(r: RipioOrderRow): DurableRipioOrder { return { homeOrderId:r.home_order_id,homeCustomerKey:r.home_customer_key,country:r.country,customerId:r.provider_customer_id,quoteId:r.provider_quote_id,providerOrderId:r.provider_order_id,operationType:r.operation_type,fromCurrency:r.from_currency,toCurrency:r.to_currency,chain:r.chain,paymentMethodType:r.payment_method_type,destination:r.destination,tokenAddress:r.token_address,tokenDecimals:r.token_decimals,expectedAmountAtomic:r.expected_amount_atomic,state:r.state,providerStatus:r.provider_status,providerTransactionHash:r.provider_transaction_hash,latestRefundStatus:r.latest_refund_status,latestRefundRejectionReason:r.latest_refund_rejection_reason,transferEvidence:r.transfer_evidence_json ? JSON.parse(r.transfer_evidence_json) : null,version:r.version,updatedAt:r.updated_at }; }
