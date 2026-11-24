CREATE INDEX IF NOT EXISTS customers_first_seen_id_idx ON customers (first_seen_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_credentials_email_pattern_idx ON customer_credentials (email text_pattern_ops) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_wallets_address_pattern_idx ON customer_wallets (address text_pattern_ops);
CREATE INDEX IF NOT EXISTS actions_transaction_hash_lower_idx ON actions (lower(transaction_hash)) WHERE transaction_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS funding_orders_provider_order_id_idx ON funding_orders (provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS funding_orders_customer_received_idx ON funding_orders (customer_id) WHERE state='received' AND NOT sandbox;
