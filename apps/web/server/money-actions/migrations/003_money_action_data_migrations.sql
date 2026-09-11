-- Additive schema-local completion markers for guarded money-action data migrations.
-- Schema installation creates this table but never records migration completion.

CREATE TABLE IF NOT EXISTS money_action_data_migrations (
  migration_id TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
