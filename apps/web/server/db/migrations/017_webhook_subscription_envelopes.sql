ALTER TABLE webhook_subscriptions ADD COLUMN envelope text;
ALTER TABLE webhook_subscriptions ADD COLUMN key_version integer;
ALTER TABLE webhook_subscriptions ALTER COLUMN secret DROP NOT NULL;
ALTER TABLE webhook_subscriptions ADD CONSTRAINT webhook_subscription_credential CHECK ((secret IS NULL) <> (envelope IS NULL));
ALTER TABLE webhook_subscriptions ADD CONSTRAINT webhook_subscription_envelope_version CHECK (
  (envelope IS NULL) = (key_version IS NULL) AND
  (envelope IS NULL OR (
    length(envelope) <= 8192 AND
    envelope ~ '^v[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' AND
    key_version >= 1 AND
    split_part(envelope, '.', 1) = 'v' || key_version::text
  ))
);
CREATE INDEX webhook_subscriptions_key_version_idx ON webhook_subscriptions (key_version);
