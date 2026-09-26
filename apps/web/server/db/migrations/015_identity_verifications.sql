CREATE TABLE identity_verifications (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 provider text NOT NULL DEFAULT 'sumsub' CHECK (provider IN ('sumsub')),
 provider_env text NOT NULL CHECK (provider_env IN ('sandbox','production')),
 external_user_id text NOT NULL UNIQUE, applicant_id text UNIQUE,
 level_name text, review_state text NOT NULL DEFAULT 'not-submitted' CHECK (review_state IN ('not-submitted','pending','manual-review','approved','retry','final','duplicate')),
 retry_reason text CHECK (retry_reason IN ('photo-quality','document-incomplete','document-expired','document-unsupported','selfie','proof-of-address','proof-of-identity')),
 lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','reset','deactivated','removed')),
 attempt_count int CHECK (attempt_count >= 0), level_moved_at timestamptz, level_moved_attempt_count int CHECK (level_moved_attempt_count >= -1), review_id text CHECK (length(review_id) <= 64 AND review_id ~ '^[A-Za-z0-9]+$'), review_created_at timestamptz,
 approved_at timestamptz, consent_version text NOT NULL, consent_locale text CHECK (length(consent_locale) <= 35),
 consented_level text NOT NULL, consented_at timestamptz NOT NULL, reconciled_at timestamptz, reconcile_attempted_at timestamptz, superseded_at timestamptz,
 approval_announced boolean NOT NULL DEFAULT false,
 version int NOT NULL DEFAULT 0 CHECK (version >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (retry_reason IS NULL OR review_state = 'retry'),
 CHECK (approved_at IS NULL OR review_state = 'approved'),
 CHECK (lifecycle <> 'removed' OR applicant_id IS NULL)
);
CREATE OR REPLACE FUNCTION prevent_identity_verification_removal() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'identity verifications cannot be removed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER identity_verifications_no_delete BEFORE DELETE ON identity_verifications FOR EACH ROW EXECUTE FUNCTION prevent_identity_verification_removal();
CREATE TRIGGER identity_verifications_no_truncate BEFORE TRUNCATE ON identity_verifications FOR EACH STATEMENT EXECUTE FUNCTION prevent_identity_verification_removal();
CREATE UNIQUE INDEX identity_verifications_active_unique ON identity_verifications(customer_id,provider,provider_env) WHERE superseded_at IS NULL;
CREATE INDEX identity_verifications_reconcile_idx ON identity_verifications(provider_env,GREATEST(reconciled_at,reconcile_attempted_at)) WHERE superseded_at IS NULL;

CREATE TABLE identity_request_limits (
 customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 requested_at timestamptz NOT NULL
);
CREATE INDEX identity_request_limits_customer_requested_idx ON identity_request_limits(customer_id,requested_at);

CREATE TABLE identity_verification_events (
 id uuid PRIMARY KEY, verification_id uuid NOT NULL REFERENCES identity_verifications(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 source text NOT NULL CHECK (source IN ('webhook','reconcile','session')),
 review_state text NOT NULL CHECK (review_state IN ('not-submitted','pending','manual-review','approved','retry','final','duplicate')),
 lifecycle text NOT NULL CHECK (lifecycle IN ('active','reset','deactivated','removed')),
 level_name text, approved boolean NOT NULL,
 raw_review_status text CHECK (length(raw_review_status) <= 32 AND raw_review_status ~ '^[A-Za-z]+$'),
 raw_review_answer text CHECK (length(raw_review_answer) <= 32 AND raw_review_answer ~ '^[A-Za-z]+$'),
 raw_reject_type text CHECK (length(raw_reject_type) <= 32 AND raw_reject_type ~ '^[A-Za-z]+$'),
 attempt_count int CHECK (attempt_count >= 0), review_id text CHECK (length(review_id) <= 64 AND review_id ~ '^[A-Za-z0-9]+$'), review_created_at timestamptz,
 consent_version text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION prevent_identity_event_mutation() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'identity events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER identity_events_no_update BEFORE UPDATE ON identity_verification_events FOR EACH ROW EXECUTE FUNCTION prevent_identity_event_mutation();
CREATE TRIGGER identity_events_no_delete BEFORE DELETE ON identity_verification_events FOR EACH ROW EXECUTE FUNCTION prevent_identity_event_mutation();
CREATE TRIGGER identity_events_no_truncate BEFORE TRUNCATE ON identity_verification_events FOR EACH STATEMENT EXECUTE FUNCTION prevent_identity_event_mutation();

CREATE TABLE customer_restrictions (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK (kind IN ('identity-final-rejection')),
 provider_env text NOT NULL CHECK (provider_env IN ('sandbox','production')),
 source_verification_id uuid REFERENCES identity_verifications(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
 released_by text CHECK (length(released_by) BETWEEN 1 AND 200),
 CHECK ((released_at IS NULL) = (released_by IS NULL))
);
CREATE UNIQUE INDEX customer_restrictions_active_unique ON customer_restrictions(customer_id,kind,provider_env) WHERE released_at IS NULL;
CREATE OR REPLACE FUNCTION prevent_restriction_mutation() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'restriction is immutable'; END IF;
 IF TG_OP = 'UPDATE' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND NEW.released_by IS NOT NULL AND
    (NEW.id,NEW.customer_id,NEW.kind,NEW.provider_env,NEW.source_verification_id,NEW.created_at) IS NOT DISTINCT FROM
    (OLD.id,OLD.customer_id,OLD.kind,OLD.provider_env,OLD.source_verification_id,OLD.created_at) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'restriction is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER customer_restrictions_no_mutation BEFORE UPDATE OR DELETE ON customer_restrictions FOR EACH ROW EXECUTE FUNCTION prevent_restriction_mutation();
CREATE TRIGGER customer_restrictions_no_truncate BEFORE TRUNCATE ON customer_restrictions FOR EACH STATEMENT EXECUTE FUNCTION prevent_restriction_mutation();
ALTER TABLE operator_events DROP CONSTRAINT operator_events_name_check;
ALTER TABLE operator_events ADD CONSTRAINT operator_events_name_check CHECK (name IN ('customer.signed_up','funding.order_created','funding.order_finalized','action.confirmed','verification.changed','identity.approval_changed'));
