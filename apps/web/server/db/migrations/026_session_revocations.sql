CREATE TABLE home_session_revocations (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX home_session_revocations_expiry_idx ON home_session_revocations(expires_at,token_digest);
