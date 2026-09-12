# Money-action persistence

Status: shipped state as of September 12, 2026.

Home uses `money_action_operations` as the only runtime persistence model for money actions. The noncustodial boundary remains:

> server prepare → atomic dispatch claim → client wallet submission → durable provider evidence → verified reconciliation

## Durable model

Each operation row contains the immutable reviewed plan and `review_hash`, the verified owner tuple, atomic claim state, provider handles, optional verified execution identity, admission release timestamp, and lifecycle timestamps. PostgreSQL is the sole runtime adapter; `MemoryMoneyActionStore` is a process-local contract test double.

Fresh schemas apply:

1. `apps/web/server/money-actions/migrations/001_money_action_operations.sql`
2. `apps/web/server/money-actions/migrations/004_money_action_evidence_indexes.sql`

Migrations 002 and 003 are retained as history but are no longer applied to fresh schemas. Existing `money_action_attempt_states`, `money_action_attempt_evidence`, and `money_action_data_migrations` tables are not read or written at runtime. Migration 005 is an operator-only, irreversible retention action; schema readiness and `money-actions:migrate` never apply it.

## Provider-handle uniqueness

Two partial unique indexes enforce owner-scoped cross-action uniqueness:

- Base `submission_id` is opaque and compared byte-for-byte.
- CDP `user_operation_hash` is compared through `LOWER(user_operation_hash)`.

The tuple is `(subject, address, chain_id, account_provider, handle)`. Transaction hashes are intentionally not unique because one transaction may contain several account operations.

Before index creation, schema application groups existing rows by the same tuples. Duplicate groups fail readiness with at most ten `{ action_id_count, kind }` diagnostics. The preflight never logs row values, mutates rows, or deduplicates automatically.

## Runtime behavior

`runtime-store.ts` constructs `PostgresMoneyActionStore` directly and awaits schema readiness. Runtime access still requires `DATABASE_URL` plus the existing verified-empty cutover assertion; missing cutover verification fails closed.

`recordSubmission` checks for an existing owner-scoped reference before updating and relies on the indexes for concurrent races. A unique violation returns `null`, preserving the existing route conflict behavior. Admission release writes `abandoned_at` only and does not change execution status. Late evidence and verified reconciliation remain allowed.

## Safety invariants

- Only the atomic prepared-row claim grants first wallet dispatch.
- Every operation is scoped to subject, lowercased address, Base chain ID, and account provider.
- Missing provider evidence is never permission to resubmit after wallet invocation may have begun.
- Conflicting provider handles fail closed.
- Verified execution identities remain unique.
- Admission release does not assert onchain cancellation or terminalize the operation.
- No provider call occurs inside a database transaction.

## Retained provider facts

`apps/web/server/money-actions/provider-submission-contract.ts` keeps the pure CDP and EIP-5792 submission-certainty classifications established by the provider Soft Pass work. The client does not yet import the module; a follow-up should wire it into client execution or delete it.

## Legacy-table retention action

`bun run money-actions:cleanup-legacy` defaults to a read-only preflight. It requires the reviewed database and schema names, immutable evidence identifying the deployed revision and observation window, zero observed legacy reads and writes, and the `money_action_operations-only-v1` runtime contract. References must be canonical `api.github.com/repos/jessepollak/home/issues/comments/<id>` URLs without query strings, fragments, userinfo, or embedded secrets. Database preflight resets `search_path` to `pg_catalog`, locks the schema-qualified objects for inspection, and validates catalog database/schema/table OIDs, ordinary-table kinds, the full operation schema, and valid unique-index **definitions** for verified execution, exact Base submission IDs, and case-insensitive user-operation hashes. It reports only the sanitized evidence metadata, exact catalog identity, and aggregate row counts.

The drop mode additionally requires separate Jesse-approval and database-backup evidence references, the exact confirmation `DROP_LEGACY_MONEY_ACTION_TABLES_ISSUE_314`, the database/schema/table OIDs, and all four counts copied from the reviewed preflight. It resolves only the three schema-qualified legacy targets, takes access-exclusive locks, then rechecks catalog identity and counts immediately before executing migration 005 without `IF EXISTS`, `CASCADE`, or unqualified names. It verifies that operation row count and evidence index definitions are unchanged before commit. Any identity, preflight, lock, dependency, count-drift, drop, or verification failure rolls the transaction back. CLI errors use bounded allowlisted reasons and never print arbitrary database-provider messages. After a successful commit the deleted legacy rows are not reconstructible by this repository; post-commit rollback requires restoring the operator-approved database backup.

This tooling is not authorization to run the drop. #313 must first be merged and deployed, its exact deployed runtime must have an attached zero-use observation, and Jesse must separately authorize the exact drop invocation. Retain the preflight output, approval reference, database backup reference, and verification output with #314.

## Rollback and follow-ups

Before migration 005 is executed, reverting the application code leaves the two indexes harmless and the historical tables available. After it commits, old code that reads the legacy tables is deliberately incompatible and rollback requires a database restore plus the matching old application. The operator decision about retaining the cutover flag and client use of the provider classification module remain separate follow-ups.
