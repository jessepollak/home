CREATE TABLE card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('bridge', 'immersve')),
  mode text NOT NULL CHECK (mode IN ('sandbox', 'production')),
  provider_transaction_id text NOT NULL,
  authorization_id text,
  kind text NOT NULL CHECK (kind IN ('authorization', 'transaction')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  merchant_name text NOT NULL,
  merchant_category text,
  status text NOT NULL CHECK (status IN ('pending', 'declined', 'completed', 'reversed', 'refunded')),
  decline_reason_code text,
  provider_created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, mode, provider_transaction_id)
);
CREATE INDEX card_transactions_card_time_idx ON card_transactions(card_id, provider_created_at DESC);
CREATE INDEX card_transactions_auth_idx ON card_transactions(card_id, authorization_id) WHERE authorization_id IS NOT NULL;
