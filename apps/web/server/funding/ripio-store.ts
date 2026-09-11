import "server-only";

import type { SqlExecutor } from "@/server/money-actions/postgres-sql";
import type { DurableRipioOrder, RipioReconciliationStore, RipioWebhookEvent } from "./ripio-reconciliation";

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
  destination TEXT NOT NULL,
  token_address TEXT NOT NULL,
  expected_amount_atomic TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_status TEXT NOT NULL,
  provider_transaction_hash TEXT,
  transfer_evidence_json TEXT,
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
CREATE INDEX IF NOT EXISTS ripio_orders_customer_recent
  ON ripio_orders (home_customer_key, updated_at DESC);`;

export const ripioSchemaStatements = RIPIO_SCHEMA_SQL.split(";").map((value) => value.trim()).filter(Boolean);

export class PostgresRipioStore implements RipioReconciliationStore {
  private initialized: Promise<void> | null = null;
  constructor(private readonly sql: SqlExecutor, private readonly now: () => string = () => new Date().toISOString()) {}

  async ensureSchema(): Promise<void> {
    this.initialized ??= (async () => {
      for (const statement of ripioSchemaStatements) await this.sql.query(statement);
    })();
    return this.initialized;
  }

  async putCustomer(input: { homeCustomerKey: string; country: "AR" | "CO"; providerCustomerId: string }): Promise<void> {
    await this.ensureSchema();
    const now = this.now();
    await this.sql.query(
      `INSERT INTO ripio_customers (home_customer_key, country, provider_customer_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (home_customer_key) DO UPDATE SET
         provider_customer_id = CASE WHEN ripio_customers.provider_customer_id = EXCLUDED.provider_customer_id THEN EXCLUDED.provider_customer_id ELSE ripio_customers.provider_customer_id END,
         updated_at = EXCLUDED.updated_at`,
      [input.homeCustomerKey, input.country, input.providerCustomerId, now],
    );
  }

  async putOrder(order: DurableRipioOrder): Promise<void> {
    await this.ensureSchema();
    await this.sql.query(
      `INSERT INTO ripio_orders (
        home_order_id, home_customer_key, country, provider_customer_id, provider_quote_id,
        provider_order_id, destination, token_address, expected_amount_atomic, state,
        provider_status, provider_transaction_hash, transfer_evidence_json, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      orderValues(order),
    );
  }

  async hasWebhookEvent(eventId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.sql.query(`SELECT event_id FROM ripio_webhook_events WHERE event_id = $1`, [eventId]);
    return result.rowCount > 0;
  }

  async recordWebhookEvent(event: RipioWebhookEvent, rawBodyDigest: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.sql.query(
      `INSERT INTO ripio_webhook_events (event_id, provider_order_id, status, occurred_at, raw_body_digest, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.eventId, event.providerOrderId, event.status, event.occurredAt, rawBodyDigest, this.now()],
    );
    return result.rowCount === 1;
  }

  async getByProviderOrderId(providerOrderId: string): Promise<DurableRipioOrder | null> {
    await this.ensureSchema();
    const result = await this.sql.query<RipioOrderRow>(
      `SELECT * FROM ripio_orders WHERE provider_order_id = $1`, [providerOrderId],
    );
    return result.rows[0] ? rowToOrder(result.rows[0]) : null;
  }

  async saveReconciledOrder(order: DurableRipioOrder): Promise<void> {
    await this.ensureSchema();
    await this.sql.query(
      `UPDATE ripio_orders SET state=$1, provider_status=$2, provider_transaction_hash=$3,
       transfer_evidence_json=$4, updated_at=$5 WHERE home_order_id=$6 AND provider_order_id=$7`,
      [order.state, order.providerStatus, order.providerTransactionHash, order.transferEvidence ? JSON.stringify(order.transferEvidence) : null, order.updatedAt, order.homeOrderId, order.providerOrderId],
    );
  }
}

type RipioOrderRow = {
  home_order_id: string; home_customer_key: string; country: "AR" | "CO";
  provider_customer_id: string; provider_quote_id: string; provider_order_id: string;
  destination: `0x${string}`; token_address: `0x${string}`; expected_amount_atomic: string;
  state: DurableRipioOrder["state"]; provider_status: string; provider_transaction_hash: `0x${string}` | null;
  transfer_evidence_json: string | null; updated_at: string;
};

function orderValues(order: DurableRipioOrder): unknown[] {
  return [order.homeOrderId, order.homeCustomerKey, order.country, order.customerId, order.quoteId, order.providerOrderId, order.destination, order.tokenAddress, order.expectedAmountAtomic, order.state, order.providerStatus, order.providerTransactionHash, order.transferEvidence ? JSON.stringify(order.transferEvidence) : null, order.updatedAt];
}
function rowToOrder(row: RipioOrderRow): DurableRipioOrder {
  return { homeOrderId: row.home_order_id, homeCustomerKey: row.home_customer_key, country: row.country, customerId: row.provider_customer_id, quoteId: row.provider_quote_id, providerOrderId: row.provider_order_id, destination: row.destination, tokenAddress: row.token_address, expectedAmountAtomic: row.expected_amount_atomic, state: row.state, providerStatus: row.provider_status, providerTransactionHash: row.provider_transaction_hash, transferEvidence: row.transfer_evidence_json ? JSON.parse(row.transfer_evidence_json) : null, updatedAt: row.updated_at };
}
