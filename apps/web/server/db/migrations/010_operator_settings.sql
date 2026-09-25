CREATE TABLE IF NOT EXISTS operator_settings (
  domain text PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  value jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL CHECK (action IN ('settings.update', 'customer.read')),
  target_kind text NOT NULL CHECK (target_kind IN ('settings', 'customer')),
  target_id text NOT NULL,
  purpose text,
  before jsonb,
  after jsonb,
  CONSTRAINT admin_audit_shape CHECK (
    (action = 'settings.update' AND target_kind = 'settings' AND purpose IS NULL AND after IS NOT NULL)
    OR (action = 'customer.read' AND target_kind = 'customer' AND purpose IS NOT NULL AND before IS NULL AND after IS NULL)
  )
);

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin audit log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_immutable ON admin_audit_log;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON admin_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();

DROP TRIGGER IF EXISTS admin_audit_no_truncate ON admin_audit_log;
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION prevent_admin_audit_mutation();
