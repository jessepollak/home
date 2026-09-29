CREATE TABLE IF NOT EXISTS customer_email_requests (
  account_provider text NOT NULL CHECK (account_provider IN ('base-account')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  asked_at timestamptz,
  answer text CHECK (answer IN ('shared','not_now','declined','failed')),
  answer_channel text CHECK (answer_channel IN ('sign_in','share_step')),
  sign_in_capability text CHECK (sign_in_capability IN ('ignored','refused')),
  wallet_code integer,
  wallet_message text CHECK (length(wallet_message) <= 300),
  bundle_id text CHECK (length(bundle_id) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_provider, subject),
  FOREIGN KEY (account_provider, subject) REFERENCES customer_credentials (account_provider, subject) ON DELETE CASCADE,
  CHECK (answer IS NULL OR asked_at IS NOT NULL)
);
