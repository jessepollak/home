CREATE TABLE card_accounts (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('sandbox', 'production')),
  bridge_customer_id text UNIQUE,
  stripe_cardholder_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, mode)
);

CREATE TABLE cards (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('sandbox', 'production')),
  stripe_card_id text NOT NULL UNIQUE,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (customer_id, mode) REFERENCES card_accounts(customer_id, mode) ON DELETE CASCADE
);
CREATE INDEX cards_mode_wallet_idx ON cards(mode, wallet_address);
CREATE INDEX cards_customer_mode_idx ON cards(customer_id, mode);
