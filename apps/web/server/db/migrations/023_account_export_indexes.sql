CREATE INDEX IF NOT EXISTS actions_export_owner_idx ON actions (owner_key);
CREATE INDEX IF NOT EXISTS admin_audit_export_target_idx ON admin_audit_log (target_kind, target_id);
CREATE INDEX IF NOT EXISTS card_events_export_customer_idx ON card_events (provider, mode, customer_id);
CREATE INDEX IF NOT EXISTS card_events_export_card_idx ON card_events (mode, card_id);
