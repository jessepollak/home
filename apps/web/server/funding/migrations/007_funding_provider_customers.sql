CREATE TABLE IF NOT EXISTS funding_provider_customers (
  id uuid PRIMARY KEY,
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 512),
  account_provider text NOT NULL CHECK (account_provider IN ('cdp-embedded', 'base-account')),
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 64),
  region text NOT NULL CHECK (length(region) BETWEEN 2 AND 16),
  customer_ref text CHECK (customer_ref IS NULL OR length(customer_ref) BETWEEN 1 AND 512),
  state text NOT NULL CHECK (state IN ('reserving','pending','verified','rejected','dispatch-ambiguous')),
  provider_created_at timestamptz,
  verification_started_at timestamptz,
  provider_submission_ref text CHECK (provider_submission_ref IS NULL OR length(provider_submission_ref) BETWEEN 1 AND 512),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_provider, owner_subject, provider_id, region),
  UNIQUE (provider_id, customer_ref),
  CHECK (
    (state = 'reserving' AND customer_ref IS NULL) OR
    (state IN ('pending','verified') AND customer_ref IS NOT NULL) OR
    state IN ('rejected','dispatch-ambiguous')
  )
);

CREATE INDEX IF NOT EXISTS funding_provider_customers_owner_region_idx
  ON funding_provider_customers (account_provider, owner_subject, region, updated_at DESC);

-- Legacy order references prove only that a customer ID was used. They do not
-- prove verification, so reconcile them as pending and require provider/operator
-- evidence before any row can become verified. UNIQUE (provider_id, customer_ref)
-- intentionally drops a conflicting legacy owner tuple fail-closed rather than
-- allowing one provider identity to belong to two Home owners. The order snapshot
-- remains intact.
INSERT INTO funding_provider_customers
  (id, owner_subject, account_provider, provider_id, region, customer_ref, state,
   provider_created_at, version, created_at, updated_at)
SELECT DISTINCT ON (account_provider, owner_subject, provider_id, region)
  gen_random_uuid(), owner_subject, account_provider, provider_id, region,
  customer_ref, 'pending', created_at, 0, created_at, updated_at
FROM funding_orders
WHERE customer_ref IS NOT NULL
  AND length(customer_ref) BETWEEN 1 AND 512
ORDER BY account_provider, owner_subject, provider_id, region, updated_at DESC
ON CONFLICT DO NOTHING;
