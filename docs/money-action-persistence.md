# Money-action persistence

Status: shipped state as of September 12, 2026.

Home uses `money_action_operations` as the only runtime persistence model for money actions. The noncustodial boundary remains:

> server prepare → atomic dispatch claim → client wallet submission → durable provider evidence → verified reconciliation

## Durable model

Each operation row contains the immutable reviewed plan and `review_hash`, the verified owner tuple, atomic claim state, provider handles, optional verified execution identity, admission release timestamp, and lifecycle timestamps. PostgreSQL is the sole runtime adapter; `MemoryMoneyActionStore` is a process-local contract test double.

Fresh schemas apply:

1. `apps/web/server/money-actions/migrations/001_money_action_operations.sql`
2. `apps/web/server/money-actions/migrations/004_money_action_evidence_indexes.sql`

Migrations 002 and 003 are retained as history but are no longer applied to fresh schemas. Existing `money_action_attempt_states`, `money_action_attempt_evidence`, and `money_action_data_migrations` tables are left untouched and are not read or written at runtime.

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

## Rollback and follow-ups

The change is additive at the database layer. Reverting the application code leaves the two indexes harmless and the historical tables available. Separate follow-ups own removal of those tables, the operator decision about retaining the cutover flag, and client use of the provider classification module.
