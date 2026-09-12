CREATE TABLE IF NOT EXISTS money_action_data_migrations (
  migration_id TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
