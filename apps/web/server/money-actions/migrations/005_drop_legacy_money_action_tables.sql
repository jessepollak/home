-- Irreversible retention action. Never apply this file directly or from schema readiness.
-- Use money-actions:cleanup-legacy only after reviewed #313 deployment evidence and
-- a separate Jesse approval for the exact drop invocation.
DROP TABLE money_action_attempt_evidence;
DROP TABLE money_action_attempt_states;
DROP TABLE money_action_data_migrations;
