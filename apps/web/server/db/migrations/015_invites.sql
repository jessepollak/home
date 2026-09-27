CREATE TABLE IF NOT EXISTS invite_codes (
  code text PRIMARY KEY CHECK (code ~ '^[abcdefghjkmnpqrstuvwxyz23456789]{10}$'),
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_invite_code_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invite codes are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invite_codes_no_update ON invite_codes;
CREATE TRIGGER invite_codes_no_update BEFORE UPDATE ON invite_codes
  FOR EACH ROW EXECUTE FUNCTION prevent_invite_code_update();

CREATE OR REPLACE FUNCTION prevent_customer_invite_update() RETURNS trigger AS $$
BEGIN
  IF NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
    RAISE EXCEPTION 'customer invite attribution is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS customers_invite_immutable ON customers;
CREATE TRIGGER customers_invite_immutable BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION prevent_customer_invite_update();

ALTER TABLE operator_events DROP CONSTRAINT IF EXISTS operator_events_name_check;
ALTER TABLE operator_events ADD CONSTRAINT operator_events_name_check
  CHECK (name IN ('customer.signed_up','funding.order_created','funding.order_finalized','action.confirmed','verification.changed','invite.attributed'));
