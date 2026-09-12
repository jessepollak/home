-- Irreversible operator template; never apply directly or from schema readiness.
-- The cleanup driver renders this shape with the catalog-resolved,
-- approval-bound schema identifier before executing these statements.
DROP TABLE "__REVIEWED_SCHEMA__"."money_action_attempt_evidence";
DROP TABLE "__REVIEWED_SCHEMA__"."money_action_attempt_states";
DROP TABLE "__REVIEWED_SCHEMA__"."money_action_data_migrations";
