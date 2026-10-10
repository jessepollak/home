-- Stale-reservation recovery and ambiguity admission both filter
-- owner/region/provider plus one state and order or bound updated_at.
-- Partial indexes keep those lookups proportional to the matching rows
-- instead of the owner's full order history.
CREATE INDEX IF NOT EXISTS funding_orders_owner_reserving_idx
  ON funding_orders (account_provider, owner_subject, region, provider_id, updated_at)
  WHERE state = 'reserving';

CREATE INDEX IF NOT EXISTS funding_orders_owner_ambiguous_idx
  ON funding_orders (account_provider, owner_subject, region, provider_id, updated_at)
  WHERE state = 'dispatch-ambiguous';
