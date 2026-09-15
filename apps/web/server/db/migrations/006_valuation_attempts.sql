create table if not exists valuation_attempts (
  asset_key text primary key,
  attempt_at timestamptz not null,
  status text not null check (status in ('fresh', 'missing', 'invalid', 'stale', 'unavailable'))
);
