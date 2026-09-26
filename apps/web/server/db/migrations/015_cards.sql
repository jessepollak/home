CREATE TABLE IF NOT EXISTS card_events (
  mode text NOT NULL CHECK (mode IN ('production', 'sandbox')),
  message_id text NOT NULL,
  topic text NOT NULL,
  cardholder_account_id text,
  card_id text,
  payment_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, message_id)
);
CREATE INDEX IF NOT EXISTS card_events_received_at ON card_events (received_at);
