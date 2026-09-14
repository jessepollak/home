ALTER TABLE funding_orders
  ADD COLUMN IF NOT EXISTS sandbox boolean NOT NULL DEFAULT false;
