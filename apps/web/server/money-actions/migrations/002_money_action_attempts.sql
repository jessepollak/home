-- Additive durable state for the v1 attempt-store contract.
-- The legacy operation row remains the compatibility lock and projection.

CREATE TABLE IF NOT EXISTS money_action_attempt_states (
  action_id TEXT PRIMARY KEY REFERENCES money_action_operations(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  verified_execution_key TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS money_action_attempt_unique_verified_execution
  ON money_action_attempt_states (verified_execution_key)
  WHERE verified_execution_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS money_action_attempt_evidence (
  evidence_key TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES money_action_operations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS money_action_attempt_evidence_action
  ON money_action_attempt_evidence (action_id);
