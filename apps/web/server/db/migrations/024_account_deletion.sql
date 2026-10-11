CREATE INDEX actions_legacy_owner_pattern_idx ON actions(owner_key text_pattern_ops) WHERE customer_id IS NULL;
ALTER TABLE customers ADD COLUMN retained_until timestamptz;
CREATE INDEX customers_retained_expiry_idx ON customers(retained_until,id) WHERE retained_until IS NOT NULL;
CREATE INDEX customers_merged_into_idx ON customers(merged_into) WHERE merged_into IS NOT NULL;
ALTER TABLE funding_orders ALTER COLUMN destination DROP NOT NULL;
ALTER TABLE funding_orders ALTER COLUMN quote_token DROP NOT NULL;
ALTER TABLE funding_orders ALTER COLUMN intent_digest DROP NOT NULL;
ALTER TABLE cards ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE card_transactions ALTER COLUMN merchant_name DROP NOT NULL;
ALTER TABLE card_transactions ADD COLUMN authorization_closed boolean;
CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  session_owner_keys text[],
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','completed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_attempt_at timestamptz,
  last_attempt_outcome text CHECK (last_attempt_outcome IN ('blocked','failed')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  receipt jsonb,
  expires_at timestamptz,
  CHECK ((status='queued' AND completed_at IS NULL AND expires_at IS NULL AND receipt IS NULL AND customer_id IS NOT NULL)
    OR (status='completed' AND completed_at IS NOT NULL AND expires_at IS NOT NULL AND receipt IS NOT NULL AND customer_id IS NULL AND session_owner_keys IS NULL))
);
CREATE UNIQUE INDEX account_deletion_queued_customer_idx ON account_deletion_requests(customer_id) WHERE status='queued';
CREATE INDEX account_deletion_queued_time_idx ON account_deletion_requests(last_attempt_at NULLS FIRST,id) WHERE status='queued';
CREATE INDEX account_deletion_expiry_idx ON account_deletion_requests(expires_at,id) WHERE expires_at IS NOT NULL;
CREATE TABLE account_deletion_tombstones (
  credential_digest text PRIMARY KEY CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  key_id text NOT NULL CHECK (key_id ~ '^[0-9a-f]{8}$'),
  request_id uuid NOT NULL REFERENCES account_deletion_requests(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_deletion_tombstones_request_idx ON account_deletion_tombstones(request_id);
CREATE TABLE account_deletion_audit_expiry (
  target_id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_deletion_audit_expiry_idx ON account_deletion_audit_expiry(expires_at,target_id);
CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.target_kind='customer'
    AND EXISTS (SELECT 1 FROM account_deletion_audit_expiry e WHERE e.target_id=OLD.target_id AND e.expires_at<=now())
    AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id::text=OLD.target_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'admin audit log is append-only';
END;
$$;
CREATE INDEX customers_invite_attribution_idx ON customers(invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX operator_events_invite_code_idx ON operator_events((props->>'inviteCode')) WHERE props ? 'inviteCode';
CREATE INDEX operator_events_inviter_idx ON operator_events((props->>'inviterCustomerId')) WHERE props ? 'inviterCustomerId';
CREATE OR REPLACE FUNCTION prevent_customer_invite_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invite_code IS DISTINCT FROM OLD.invite_code AND NOT (
    NEW.invite_code IS NULL AND EXISTS (
      SELECT 1 FROM invite_codes i JOIN account_deletion_audit_expiry e ON e.target_id=i.customer_id::text
      WHERE i.code=OLD.invite_code
    )
  ) THEN
    RAISE EXCEPTION 'customer invite attribution is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION prevent_operator_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  removable text[];
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS (SELECT 1 FROM customers WHERE id=OLD.customer_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    removable := array_remove(ARRAY[
      CASE WHEN EXISTS (SELECT 1 FROM invite_codes i JOIN account_deletion_audit_expiry e ON e.target_id=i.customer_id::text WHERE i.code=OLD.props->>'inviteCode') THEN 'inviteCode' END,
      CASE WHEN EXISTS (SELECT 1 FROM account_deletion_audit_expiry e WHERE e.target_id=OLD.props->>'inviterCustomerId') THEN 'inviterCustomerId' END
    ],NULL);
    IF cardinality(removable)>0 AND NEW.props=OLD.props-removable
      AND (to_jsonb(NEW)-'props')=(to_jsonb(OLD)-'props') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'operator events are append-only';
END;
$$;

CREATE INDEX card_events_deletion_cardholder_idx ON card_events(provider,mode,cardholder_account_id) WHERE cardholder_account_id IS NOT NULL;
