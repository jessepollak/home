CREATE TABLE funding_provider_user_tokens (
  account_provider text NOT NULL CHECK (account_provider IN ('cdp-embedded', 'base-account')),
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 512),
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 64),
  region text NOT NULL CHECK (length(region) BETWEEN 2 AND 16),
  sandbox boolean NOT NULL,
  destination text NOT NULL CHECK (destination ~ '^0x[0-9a-f]{40}$'),
  envelope text NOT NULL CHECK (length(envelope) <= 8192 AND envelope ~ '^v[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  key_version integer NOT NULL CHECK (key_version >= 1),
  CONSTRAINT funding_user_token_envelope_version CHECK (split_part(envelope, '.', 1) = 'v' || key_version::text),
  returned_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_provider, owner_subject, provider_id, region, sandbox)
);
CREATE INDEX funding_provider_user_tokens_key_version_idx ON funding_provider_user_tokens (key_version);
