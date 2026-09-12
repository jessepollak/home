-- Candidate-only #301 clean-install migration. As of 2026-09-12 this schema has
-- never shipped on origin/main or to a deployment. If that changes, replace edits
-- to this file with a new additive migration before applying further revisions.
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
  quote_token text NOT NULL,
  customer_ref text,
  state text NOT NULL,
  creation_block numeric(78,0) NOT NULL,
  provider_order_id text,
  expected_token_amount_atomic text,
  fees jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  instructions jsonb,
  provider_status text,
  provider_transaction_hash text,
  transaction_hash text,
  log_index integer,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_provider, owner_subject, intent_digest),
  UNIQUE (provider_id, provider_order_id),
  UNIQUE (transaction_hash, log_index),
  CHECK ((transaction_hash IS NULL AND log_index IS NULL) OR (transaction_hash IS NOT NULL AND log_index IS NOT NULL)),
  CHECK (state NOT IN ('dispatch-ambiguous','received','expired','cancelled','failed','refunded') OR instructions IS NULL),
  CHECK (state = 'received' OR transaction_hash IS NULL)
);

CREATE INDEX IF NOT EXISTS funding_orders_owner_open_idx
  ON funding_orders (account_provider, owner_subject, region, updated_at DESC);

CREATE OR REPLACE FUNCTION prevent_funding_receipt_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.transaction_hash IS NOT NULL AND (
    NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash OR
    NEW.log_index IS DISTINCT FROM OLD.log_index
  ) THEN
    RAISE EXCEPTION 'verified funding receipt evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS funding_orders_immutable_receipt ON funding_orders;
CREATE TRIGGER funding_orders_immutable_receipt
  BEFORE UPDATE ON funding_orders
  FOR EACH ROW EXECUTE FUNCTION prevent_funding_receipt_mutation();
