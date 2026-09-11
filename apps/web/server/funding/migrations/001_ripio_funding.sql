-- Durable Ripio references only. No access tokens, secrets, signatures, identity
-- documents, email addresses, bank details, or webhook bodies are stored here.
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
  ON ripio_orders (home_customer_key, updated_at DESC);
