-- Owner-scoped cross-action uniqueness of provider handles, replacing the
-- money_action_attempt_evidence reservation table at runtime.
-- Provider is implied by account_provider: user_operation_hash is only written
-- for cdp-embedded and submission_id only for base-account (handlers.ts route
-- validation; shared/money-actions/provider-handle.ts).
CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_owner_submission_id
  ON money_action_operations (subject, address, chain_id, account_provider, submission_id)
  WHERE submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_owner_user_operation_hash
  ON money_action_operations (subject, address, chain_id, account_provider, LOWER(user_operation_hash))
  WHERE user_operation_hash IS NOT NULL;
