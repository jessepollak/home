ALTER TABLE funding_orders ADD COLUMN IF NOT EXISTS abandon_reason text;
ALTER TABLE funding_orders ADD COLUMN IF NOT EXISTS checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'funding_orders'::regclass AND conname = 'funding_orders_abandon_reason_check'
  ) THEN
    ALTER TABLE funding_orders ADD CONSTRAINT funding_orders_abandon_reason_check
      CHECK (abandon_reason IS NULL OR abandon_reason IN ('owner', 'timed-out'));
  END IF;
END;
$$;
