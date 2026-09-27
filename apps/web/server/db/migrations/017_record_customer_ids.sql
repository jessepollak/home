ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES customer_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_id uuid REFERENCES customer_wallets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS actions_customer_created_idx ON actions (customer_id, created_at DESC);

ALTER TABLE funding_orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES customer_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_id uuid REFERENCES customer_wallets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS funding_orders_customer_created_idx ON funding_orders (customer_id, created_at DESC);

ALTER TABLE funding_provider_customers
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES customer_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_id uuid REFERENCES customer_wallets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS funding_provider_customers_customer_idx ON funding_provider_customers (customer_id);

ALTER TABLE funding_provider_user_tokens
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES customer_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_id uuid REFERENCES customer_wallets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS funding_provider_user_tokens_customer_idx ON funding_provider_user_tokens (customer_id);
