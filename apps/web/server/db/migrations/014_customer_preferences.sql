CREATE TABLE IF NOT EXISTS customer_preferences (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  country_preference text CHECK (country_preference ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
