ALTER TABLE card_accounts ADD COLUMN provider text NOT NULL DEFAULT 'bridge' CHECK (provider IN ('bridge','rain','immersve'));
ALTER TABLE card_accounts ADD COLUMN provider_account_id text;
ALTER TABLE card_accounts ADD COLUMN provider_cardholder_id text;
UPDATE card_accounts SET provider_account_id=bridge_customer_id, provider_cardholder_id=stripe_cardholder_id;
ALTER TABLE card_accounts DROP COLUMN bridge_customer_id, DROP COLUMN stripe_cardholder_id;
ALTER TABLE card_accounts ALTER COLUMN provider DROP DEFAULT;
ALTER TABLE card_accounts ADD UNIQUE (customer_id,mode,provider);
CREATE UNIQUE INDEX card_accounts_provider_account_idx ON card_accounts(provider,mode,provider_account_id) WHERE provider_account_id IS NOT NULL;
CREATE UNIQUE INDEX card_accounts_provider_cardholder_idx ON card_accounts(provider,mode,provider_cardholder_id) WHERE provider_cardholder_id IS NOT NULL;

ALTER TABLE cards ADD COLUMN provider text NOT NULL DEFAULT 'bridge' CHECK (provider IN ('bridge','rain','immersve'));
ALTER TABLE cards ADD COLUMN provider_card_id text;
UPDATE cards SET provider_card_id=stripe_card_id;
ALTER TABLE cards ALTER COLUMN provider_card_id SET NOT NULL;
ALTER TABLE cards DROP COLUMN stripe_card_id;
ALTER TABLE cards ALTER COLUMN provider DROP DEFAULT;
ALTER TABLE cards ADD UNIQUE (provider,mode,provider_card_id);
ALTER TABLE cards DROP CONSTRAINT cards_customer_id_mode_fkey;
ALTER TABLE cards ADD FOREIGN KEY (customer_id,mode,provider) REFERENCES card_accounts(customer_id,mode,provider) ON DELETE CASCADE;

ALTER TABLE card_events DROP CONSTRAINT card_events_provider_check;
ALTER TABLE card_events ADD CHECK (provider IN ('bridge','rain','immersve'));
ALTER TABLE card_transactions DROP CONSTRAINT card_transactions_provider_check;
ALTER TABLE card_transactions ADD CHECK (provider IN ('bridge','rain','immersve'));
CREATE INDEX card_events_provider_card_idx ON card_events(provider,mode,card_id,received_at) WHERE card_id IS NOT NULL;
