CREATE TABLE IF NOT EXISTS invite_rewards (
  id uuid PRIMARY KEY,
  invitee_customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  inviter_customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invite_code text NOT NULL,
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
  attributed_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'joined'
    CHECK (state IN ('joined', 'saved', 'qualified', 'approved', 'rejected', 'disqualified', 'ineligible')),
  reason text CHECK (reason IN ('country-not-offered', 'country-unknown', 'balance-dropped')),
  deposit_action_id uuid REFERENCES actions(id) ON DELETE SET NULL,
  deposit_tx_hash text CHECK (deposit_tx_hash ~ '^0x[0-9a-f]{64}$'),
  deposit_block_number numeric(20, 0) CHECK (deposit_block_number > 0),
  deposit_at timestamptz,
  deposit_assets_atoms numeric(78, 0) CHECK (deposit_assets_atoms > 0),
  deposit_shares_atoms numeric(78, 0) CHECK (deposit_shares_atoms > 0),
  window_ends_at timestamptz,
  min_shares_atoms numeric(78, 0) CHECK (min_shares_atoms >= 0),
  qualified_at timestamptz,
  evaluated_at timestamptz,
  history_pending text CHECK (history_pending IN ('history-unavailable', 'history-behind')),
  risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risk_signals) = 'array'),
  decided_at timestamptz,
  decided_by text CHECK (decided_by ~ '^0x[0-9a-f]{40}$'),
  decision_reason text CHECK (length(decision_reason) BETWEEN 1 AND 200),
  reserved_atoms numeric(78, 0) CHECK (reserved_atoms > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inviter_customer_id <> invitee_customer_id),
  CHECK (COALESCE(CASE state
    WHEN 'ineligible' THEN reason IN ('country-not-offered', 'country-unknown')
    WHEN 'disqualified' THEN reason = 'balance-dropped'
    ELSE reason IS NULL END, false)),
  CHECK (state IN ('joined', 'ineligible') OR (deposit_tx_hash IS NOT NULL AND deposit_block_number IS NOT NULL
    AND deposit_at IS NOT NULL AND deposit_assets_atoms IS NOT NULL AND deposit_shares_atoms IS NOT NULL AND window_ends_at IS NOT NULL)),
  CHECK (state NOT IN ('qualified', 'approved') OR qualified_at IS NOT NULL),
  CHECK (state IN ('qualified', 'approved', 'rejected') OR qualified_at IS NULL),
  CHECK ((state = 'approved') = (reserved_atoms IS NOT NULL)),
  CHECK ((state IN ('approved', 'rejected')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CHECK (state <> 'rejected' OR decision_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS invite_rewards_inviter_idx ON invite_rewards (inviter_customer_id, attributed_at DESC);
CREATE INDEX IF NOT EXISTS invite_rewards_open_idx ON invite_rewards (evaluated_at NULLS FIRST) WHERE state IN ('joined', 'saved');
CREATE INDEX IF NOT EXISTS invite_rewards_queue_idx ON invite_rewards (qualified_at) WHERE state = 'qualified';
CREATE INDEX IF NOT EXISTS invite_rewards_reserved_idx ON invite_rewards (inviter_customer_id) WHERE reserved_atoms IS NOT NULL;

CREATE OR REPLACE FUNCTION invite_rewards_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  settings jsonb;
  cap integer;
  budget numeric;
  inviter_reserved integer;
  total_reserved numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.invitee_customer_id <> OLD.invitee_customer_id OR NEW.inviter_customer_id <> OLD.inviter_customer_id
       OR NEW.terms IS DISTINCT FROM OLD.terms OR NEW.attributed_at <> OLD.attributed_at THEN
      RAISE EXCEPTION 'invite reward identity and terms are immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state IN ('approved', 'rejected', 'disqualified', 'ineligible') THEN
      IF NEW.state <> OLD.state OR
         ROW(NEW.reserved_atoms, NEW.decided_at, NEW.decided_by, NEW.decision_reason, NEW.risk_signals,
           NEW.deposit_action_id, NEW.deposit_tx_hash, NEW.deposit_block_number, NEW.deposit_at,
           NEW.deposit_assets_atoms, NEW.deposit_shares_atoms, NEW.qualified_at, NEW.min_shares_atoms,
           NEW.window_ends_at, NEW.invite_code, NEW.reason, NEW.history_pending) IS DISTINCT FROM
         ROW(OLD.reserved_atoms, OLD.decided_at, OLD.decided_by, OLD.decision_reason, OLD.risk_signals,
           OLD.deposit_action_id, OLD.deposit_tx_hash, OLD.deposit_block_number, OLD.deposit_at,
           OLD.deposit_assets_atoms, OLD.deposit_shares_atoms, OLD.qualified_at, OLD.min_shares_atoms,
           OLD.window_ends_at, OLD.invite_code, OLD.reason, OLD.history_pending) THEN
        RAISE EXCEPTION 'invite reward state % is final' , OLD.state USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF OLD.deposit_tx_hash IS NOT NULL AND NEW.deposit_tx_hash IS DISTINCT FROM OLD.deposit_tx_hash THEN
      RAISE EXCEPTION 'invite reward deposit anchor is immutable' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.reserved_atoms IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.reserved_atoms IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('invite_rewards_reserve', 0));
    SELECT value INTO settings FROM operator_settings WHERE domain = 'growth';
    IF settings IS NULL THEN
      RAISE EXCEPTION 'growth settings are missing' USING ERRCODE = 'check_violation', CONSTRAINT = 'invite_rewards_settings';
    END IF;
    BEGIN
      cap := (settings->>'perInviterCap')::integer;
      budget := (settings->>'budgetAtoms')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'growth settings are malformed' USING ERRCODE = 'check_violation', CONSTRAINT = 'invite_rewards_settings';
    END;
    IF cap IS NULL OR budget IS NULL OR budget::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'growth settings are missing or malformed' USING ERRCODE = 'check_violation', CONSTRAINT = 'invite_rewards_settings';
    END IF;
    SELECT count(*), COALESCE(sum(reserved_atoms), 0) INTO inviter_reserved, total_reserved
      FROM invite_rewards WHERE inviter_customer_id = NEW.inviter_customer_id AND reserved_atoms IS NOT NULL AND id <> NEW.id;
    IF inviter_reserved + 1 > cap THEN
      RAISE EXCEPTION 'per-inviter cap reached' USING ERRCODE = 'check_violation', CONSTRAINT = 'invite_rewards_cap';
    END IF;
    SELECT COALESCE(sum(reserved_atoms), 0) INTO total_reserved FROM invite_rewards WHERE reserved_atoms IS NOT NULL AND id <> NEW.id;
    IF total_reserved + NEW.reserved_atoms > budget THEN
      RAISE EXCEPTION 'program budget exhausted' USING ERRCODE = 'check_violation', CONSTRAINT = 'invite_rewards_budget';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invite_rewards_guard_trigger ON invite_rewards;
CREATE TRIGGER invite_rewards_guard_trigger BEFORE INSERT OR UPDATE ON invite_rewards
  FOR EACH ROW EXECUTE FUNCTION invite_rewards_guard();

ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN
  ('settings.update', 'customer.read', 'support.credential.update', 'support.credential.delete', 'growth.reward.approve', 'growth.reward.reject'));
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_target_kind_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_kind_check CHECK (target_kind IN ('settings', 'customer', 'reward'));
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_shape;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_shape CHECK (
  (action = 'settings.update' AND target_kind = 'settings' AND purpose IS NULL AND after IS NOT NULL)
  OR (action = 'customer.read' AND target_kind = 'customer' AND purpose IS NOT NULL AND before IS NULL AND after IS NULL)
  OR (action IN ('support.credential.update', 'support.credential.delete') AND target_kind = 'settings' AND target_id = 'support-assistant-key' AND purpose IS NULL)
  OR (action IN ('growth.reward.approve', 'growth.reward.reject') AND target_kind = 'reward' AND purpose IS NULL AND before IS NOT NULL AND after IS NOT NULL)
);
