CREATE TABLE card_reveal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('prepare','grant')),
  outcome text NOT NULL CHECK (outcome IN ('granted')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_reveal_access_card_idx ON card_reveal_access(card_id, occurred_at DESC);
CREATE INDEX card_reveal_access_customer_idx ON card_reveal_access(customer_id, occurred_at DESC);
