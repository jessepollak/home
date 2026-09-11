-- Durable Ripio references only. No tokens, credentials, PII, bank details, or raw webhook bodies.
CREATE TABLE IF NOT EXISTS ripio_customers (
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
CREATE INDEX IF NOT EXISTS ripio_inbox_pending ON ripio_webhook_inbox (recovery_state, updated_at);
