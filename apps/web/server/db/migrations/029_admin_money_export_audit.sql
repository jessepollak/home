ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN
  ('settings.update', 'customer.read', 'support.credential.update', 'support.credential.delete', 'growth.reward.approve', 'growth.reward.reject', 'money.export'));
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_target_kind_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_kind_check CHECK (target_kind IN ('settings', 'customer', 'reward', 'money'));
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_shape;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_shape CHECK (
  (action = 'settings.update' AND target_kind = 'settings' AND purpose IS NULL AND after IS NOT NULL)
  OR (action = 'customer.read' AND target_kind = 'customer' AND purpose IS NOT NULL AND before IS NULL AND after IS NULL)
  OR (action IN ('support.credential.update', 'support.credential.delete') AND target_kind = 'settings' AND target_id = 'support-assistant-key' AND purpose IS NULL)
  OR (action IN ('growth.reward.approve', 'growth.reward.reject') AND target_kind = 'reward' AND purpose IS NULL AND before IS NOT NULL AND after IS NOT NULL)
  OR (action = 'money.export' AND target_kind = 'money' AND target_id = 'movements' AND purpose IS NULL AND before IS NULL AND after IS NOT NULL)
);
