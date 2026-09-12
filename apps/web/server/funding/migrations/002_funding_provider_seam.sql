CREATE TABLE IF NOT EXISTS funding_orders (
  id uuid PRIMARY KEY,
  owner_subject text NOT NULL,
  account_provider text NOT NULL CHECK (account_provider IN ('cdp-embedded', 'base-account')),
  destination text NOT NULL CHECK (destination ~ '^0x[0-9a-f]{40}$'),
  provider_id text NOT NULL,
  region text NOT NULL,
  asset_id text NOT NULL,
  payment_method text NOT NULL,
  fiat_amount text NOT NULL CHECK (fiat_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  intent_digest text NOT NULL,
  quote jsonb NOT NULL,
  customer_ref text,
  state text NOT NULL,
  creation_block numeric(78,0) NOT NULL,
  provider_order_id text,
  expected_token_amount_atomic text,
  fees jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  instructions jsonb,
  provider_status text,
  transaction_hash text,
  log_index integer,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_provider, owner_subject, intent_digest),
  UNIQUE (provider_id, provider_order_id),
  UNIQUE (transaction_hash, log_index),
  CHECK (state NOT IN ('dispatch-ambiguous','received','expired','cancelled','failed','refunded') OR instructions IS NULL)
);

CREATE INDEX IF NOT EXISTS funding_orders_owner_open_idx
  ON funding_orders (account_provider, owner_subject, region, updated_at DESC);
