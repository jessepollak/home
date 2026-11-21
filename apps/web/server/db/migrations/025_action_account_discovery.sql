CREATE INDEX IF NOT EXISTS actions_account_confirmed_idx ON actions (account_address, confirmed_at DESC) WHERE confirmed_at IS NOT NULL;
