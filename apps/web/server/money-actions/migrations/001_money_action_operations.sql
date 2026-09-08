-- Money-action operations. Same durable fields as the local SQLite adapter.
-- Stores plans, review hashes, owner tuples, statuses, attempts, and public
-- chain/provider refs. No tokens, signatures, emails, OTPs, or private keys.
--
-- Apply with: bun run money-actions:migrate
-- (requires DATABASE_URL). The hosted store also applies this idempotently
-- on first use.

CREATE TABLE IF NOT EXISTS money_action_operations (
  id TEXT PRIMARY KEY,
  review_hash TEXT NOT NULL,
  subject TEXT NOT NULL,
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id = 8453),
  account_provider TEXT NOT NULL,
  action_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  submission_id TEXT,
  transaction_hash TEXT,
  user_operation_hash TEXT,
  verified_execution_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS money_action_owner_recent
  ON money_action_operations (subject, address, chain_id, account_provider, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_verified_execution
  ON money_action_operations (verified_execution_key)
  WHERE verified_execution_key IS NOT NULL;
