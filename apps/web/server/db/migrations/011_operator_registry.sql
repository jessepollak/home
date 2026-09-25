CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted','closed')),
  merged_into uuid REFERENCES customers(id) ON DELETE SET NULL,
  country text CHECK (country ~ '^[A-Z]{2}$'),
  invite_code text CHECK (length(invite_code) BETWEEN 1 AND 128),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  first_seen_source text NOT NULL CHECK (first_seen_source IN ('sign_in','activity','backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into <> id),
  CHECK (last_seen_at >= first_seen_at)
);
CREATE INDEX IF NOT EXISTS customers_first_seen_idx ON customers (first_seen_at);

CREATE TABLE IF NOT EXISTS customer_credentials (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  account_provider text NOT NULL CHECK (account_provider IN ('cdp-embedded','base-account')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  linked_via text NOT NULL DEFAULT 'first_use' CHECK (linked_via IN ('first_use','link')),
  email text CHECK (length(email) <= 320 AND email = lower(email)),
  email_source text CHECK (email_source IN ('cdp_verified','wallet_reported')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_provider, subject),
  CHECK ((email IS NULL) = (email_source IS NULL)),
  CHECK (last_seen_at >= first_seen_at)
);
CREATE INDEX IF NOT EXISTS customer_credentials_customer_idx ON customer_credentials (customer_id);

CREATE TABLE IF NOT EXISTS customer_wallets (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES customer_credentials(id) ON DELETE CASCADE,
  chain_id integer NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address)
);
CREATE INDEX IF NOT EXISTS customer_wallets_customer_idx ON customer_wallets (customer_id);
CREATE INDEX IF NOT EXISTS customer_wallets_credential_idx ON customer_wallets (credential_id);

CREATE TABLE IF NOT EXISTS operator_events (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name IN ('customer.signed_up','funding.order_created','funding.order_finalized','action.confirmed','verification.changed')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('live','backfill')),
  sandbox boolean NOT NULL DEFAULT false,
  props jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object'),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS operator_events_name_time_idx ON operator_events (name, occurred_at);
CREATE INDEX IF NOT EXISTS operator_events_customer_time_idx ON operator_events (customer_id, occurred_at);

CREATE OR REPLACE FUNCTION prevent_operator_event_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND
     NOT EXISTS (SELECT 1 FROM customers WHERE id = OLD.customer_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'operator events are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS operator_events_no_update ON operator_events;
DROP TRIGGER IF EXISTS operator_events_no_delete ON operator_events;
DROP TRIGGER IF EXISTS operator_events_no_truncate ON operator_events;
CREATE TRIGGER operator_events_no_update BEFORE UPDATE ON operator_events
  FOR EACH ROW EXECUTE FUNCTION prevent_operator_event_mutation();
CREATE TRIGGER operator_events_no_delete BEFORE DELETE ON operator_events
  FOR EACH ROW EXECUTE FUNCTION prevent_operator_event_mutation();
CREATE TRIGGER operator_events_no_truncate BEFORE TRUNCATE ON operator_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_operator_event_mutation();
