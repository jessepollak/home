CREATE TABLE IF NOT EXISTS history_addresses (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  window_start_block bigint NOT NULL CHECK (window_start_block >= 0),
  window_start_at timestamptz NOT NULL,
  enrolled_block bigint NOT NULL,
  backfill_block bigint NOT NULL,
  forward_block bigint NOT NULL,
  dirty_at timestamptz,
  ingested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address),
  FOREIGN KEY (chain_id, address) REFERENCES customer_wallets (chain_id, address) ON DELETE CASCADE,
  CHECK (window_start_block <= backfill_block),
  CHECK (backfill_block <= enrolled_block),
  CHECK (enrolled_block <= forward_block)
);

CREATE TABLE IF NOT EXISTS history_assets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id integer NOT NULL,
  asset_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('native', 'erc20', 'vault-share', 'morpho-collateral', 'morpho-borrow-shares')),
  contract_address text CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$'),
  market_id text CHECK (market_id IS NULL OR market_id ~ '^0x[0-9a-f]{64}$'),
  decimals smallint CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 255),
  cash_currency text,
  UNIQUE (chain_id, asset_key),
  CHECK ((kind IN ('erc20', 'vault-share')) = (contract_address IS NOT NULL)),
  CHECK ((kind IN ('morpho-collateral', 'morpho-borrow-shares')) = (market_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS balance_changes (
  address_id integer NOT NULL REFERENCES history_addresses (id) ON DELETE CASCADE,
  asset_id integer NOT NULL REFERENCES history_assets (id),
  block_number bigint NOT NULL CHECK (block_number > 0),
  log_index integer NOT NULL CHECK (log_index >= 0),
  block_time timestamptz NOT NULL,
  tx_hash bytea CHECK (tx_hash IS NULL OR octet_length(tx_hash) = 32),
  delta numeric(78, 0) NOT NULL,
  source text NOT NULL CHECK (source IN ('cdp-sql-transfer')),
  PRIMARY KEY (address_id, asset_id, block_number, log_index) INCLUDE (delta, block_time)
) PARTITION BY HASH (address_id);

CREATE TABLE IF NOT EXISTS balance_changes_p00 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 0);
CREATE TABLE IF NOT EXISTS balance_changes_p01 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 1);
CREATE TABLE IF NOT EXISTS balance_changes_p02 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 2);
CREATE TABLE IF NOT EXISTS balance_changes_p03 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 3);
CREATE TABLE IF NOT EXISTS balance_changes_p04 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 4);
CREATE TABLE IF NOT EXISTS balance_changes_p05 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 5);
CREATE TABLE IF NOT EXISTS balance_changes_p06 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 6);
CREATE TABLE IF NOT EXISTS balance_changes_p07 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 7);
CREATE TABLE IF NOT EXISTS balance_changes_p08 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 8);
CREATE TABLE IF NOT EXISTS balance_changes_p09 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 9);
CREATE TABLE IF NOT EXISTS balance_changes_p10 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 10);
CREATE TABLE IF NOT EXISTS balance_changes_p11 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 11);
CREATE TABLE IF NOT EXISTS balance_changes_p12 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 12);
CREATE TABLE IF NOT EXISTS balance_changes_p13 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 13);
CREATE TABLE IF NOT EXISTS balance_changes_p14 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 14);
CREATE TABLE IF NOT EXISTS balance_changes_p15 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 15);
CREATE TABLE IF NOT EXISTS balance_changes_p16 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 16);
CREATE TABLE IF NOT EXISTS balance_changes_p17 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 17);
CREATE TABLE IF NOT EXISTS balance_changes_p18 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 18);
CREATE TABLE IF NOT EXISTS balance_changes_p19 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 19);
CREATE TABLE IF NOT EXISTS balance_changes_p20 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 20);
CREATE TABLE IF NOT EXISTS balance_changes_p21 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 21);
CREATE TABLE IF NOT EXISTS balance_changes_p22 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 22);
CREATE TABLE IF NOT EXISTS balance_changes_p23 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 23);
CREATE TABLE IF NOT EXISTS balance_changes_p24 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 24);
CREATE TABLE IF NOT EXISTS balance_changes_p25 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 25);
CREATE TABLE IF NOT EXISTS balance_changes_p26 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 26);
CREATE TABLE IF NOT EXISTS balance_changes_p27 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 27);
CREATE TABLE IF NOT EXISTS balance_changes_p28 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 28);
CREATE TABLE IF NOT EXISTS balance_changes_p29 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 29);
CREATE TABLE IF NOT EXISTS balance_changes_p30 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 30);
CREATE TABLE IF NOT EXISTS balance_changes_p31 PARTITION OF balance_changes FOR VALUES WITH (MODULUS 32, REMAINDER 31);

CREATE TABLE IF NOT EXISTS balance_checkpoints (
  address_id integer NOT NULL REFERENCES history_addresses (id) ON DELETE CASCADE,
  asset_id integer NOT NULL REFERENCES history_assets (id),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  purpose text NOT NULL CHECK (purpose IN ('window-start', 'reconcile', 'bucket')),
  chain_quantity numeric(78, 0) NOT NULL CHECK (chain_quantity >= 0),
  log_quantity numeric(78, 0),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (address_id, asset_id, block_number)
);

CREATE TABLE IF NOT EXISTS chain_buckets (
  chain_id integer NOT NULL,
  bucket_at timestamptz NOT NULL CHECK (extract(epoch FROM bucket_at)::bigint % 3600 = 0),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  block_hash bytea NOT NULL CHECK (octet_length(block_hash) = 32),
  block_time timestamptz NOT NULL CHECK (block_time <= bucket_at),
  PRIMARY KEY (chain_id, bucket_at)
);

CREATE TABLE IF NOT EXISTS valuation_points (
  series_key text NOT NULL,
  basis_version text NOT NULL,
  granularity text NOT NULL CHECK (granularity IN ('1h', '1d')),
  bucket_at timestamptz NOT NULL,
  value_atoms numeric(78, 0) CHECK (value_atoms IS NULL OR value_atoms >= 0),
  value_scale smallint CHECK (value_scale IS NULL OR value_scale BETWEEN 0 AND 77),
  block_number bigint,
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (series_key, basis_version, granularity, bucket_at),
  CHECK ((value_atoms IS NULL) = (value_scale IS NULL)),
  CHECK (granularity <> '1d' OR extract(epoch FROM bucket_at)::bigint % 86400 = 0),
  CHECK (extract(epoch FROM bucket_at)::bigint % 3600 = 0)
);

CREATE INDEX IF NOT EXISTS valuation_points_hourly_bucket_idx ON valuation_points (bucket_at) WHERE granularity = '1h';
