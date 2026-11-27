CREATE INDEX IF NOT EXISTS balance_changes_funding_log_idx ON balance_changes (asset_id, block_number, log_index) INCLUDE (address_id, delta);
CREATE INDEX IF NOT EXISTS invite_rewards_attributed_idx ON invite_rewards (attributed_at);
