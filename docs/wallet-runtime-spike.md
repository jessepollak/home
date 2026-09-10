# Wallet runtime

Status: **locked money-action contract** (how it works), September 8, 2026. Not a pre-lock research spike. Filename kept for existing links.

Team/onboarding context: [architecture review](architecture-review-2026-09.md). This file is the prepare → claim → submit → receipt contract.

Home money actions now use a server-issued prepare → review → atomic claim → user-wallet submission → receipt reconciliation lifecycle. The shared contract is `apps/web/features/money-actions/types.ts`; reviewed feature adapters issue plans through `issueMoneyAction`. Browsers submit only a prepared action id and immutable review hash. The server returns the canonical calls bound to the verified CDP subject, Base address, chain 8453, and selected account provider.

## Persistence

`MoneyActionStore` (`apps/web/server/money-actions/store.ts`) is the durable port. Exactly one adapter is active per process — SQLite **or** Postgres, never both. Selection lives in `apps/web/server/money-actions/runtime-store.ts`.

**Local `bun dev` (no `DATABASE_URL`):** Node-only `node:sqlite` at `apps/web/server/money-actions/sqlite-store.node.ts`. It writes ignored runtime data to `apps/web/.local/home-money-actions.sqlite` when Next runs from the web workspace (or `.local/home-money-actions.sqlite` relative to the active process working directory), with directory mode `0700` and database mode `0600`.

**Hosted / `DATABASE_URL` set:** Neon/Postgres adapter at `apps/web/server/money-actions/postgres-store.ts` using `@neondatabase/serverless`. The Vercel path does not load `node:sqlite`. Schema: `apps/web/server/money-actions/migrations/001_money_action_operations.sql`. Operator migrate: `bun run money-actions:migrate` from local or CI with `DATABASE_URL` set (not the default Vercel build). Setup: [Vercel deploy](vercel-deploy.md).

Both adapters store action plans, immutable review hashes, owner tuples, statuses, attempts, and public chain/provider operation references. They store no access tokens, signatures, emails, OTPs, private keys, or provider credentials. Sensitive call data still expires from process memory.

### Swap runtime capability

Local development without `DATABASE_URL` keeps the existing SQLite trade-intent store. Swap intent preparation, signature finalization, and the sensitive executable calldata overlay must remain in the same local runtime through claim.

Hosted or Postgres-configured runtimes fail closed with the typed `HOSTED_SWAP_UNAVAILABLE` capability before creating a swap intent. They do not fall back to the local SQLite trade store. This guard is swap-only: send, save, and borrow claims short-circuit before trade storage, signer resolution, balance reads, Permit2 state reads, or quote-provider work.

The exact release gate for hosted swaps is a reviewed durable handoff for both the owner-bound trade intent and its executable sensitive payload across prepare, finalize, and claim instances. It must preserve intent/review hashes, expiry, signer and owner binding, quote/Permit2 checks, atomic single-dispatch behavior, and fail-closed recovery. The current Postgres action record intentionally persists only calldata digests; its executable calldata overlay is process-local, so another instance cannot claim it. No plaintext signing payload persistence, ad-hoc encryption scheme, or new key-management policy is introduced by this guard.

This is **not** production authorization. Feature plan contracts and browser execution are unchanged. CDP webhooks, Drizzle, and the rest of [target architecture](target-architecture.md) remain later work.

## Endpoints

- `POST /api/actions/send/prepare`: validates a send intent and issues the exact server-owned call plan.
- `POST /api/actions/:id/claim`: atomically creates the sole execution attempt. Repeated claims recover that attempt and never authorize another dispatch.
- `POST /api/actions/:id/submission`: attaches the same Base call-bundle, user-operation, and/or transaction reference; conflicting references are rejected. Transaction receipts are checked on Base, with EntryPoint sender/user-operation proof for embedded CDP accounts.
- `POST /api/actions/:id/status`: records only bounded wallet outcomes (`unknown`, `rejected`, `expired`, or `failed`); it cannot claim confirmation. `expired` / `rejected` / `failed` may be written from claimed `submitting` only when the row has no `submissionId` / `transactionHash` / `userOperationHash`. Check status recover does not expire reference-free `unknown`.
- `POST /api/actions/:id/admission-release`: owner-scoped Home-policy abandon. Releases the unresolved-send gate via `abandonedAt` without asserting onchain cancellation. Late provider handles remain attachable and reconcilable.
- `GET /api/actions/:id`: reads and reconciles one owner-scoped operation without resubmitting.
- `GET /api/operations` and allowlisted alias `GET /api/actions/operations`: return recent operations for Activity composition, scoped to the full verified owner/provider/address/chain tuple.

Feature modules share `AccountWalletClient.fetchAccountResource(path, options)` instead of creating another SDK/auth context. The client accepts only same-origin paths under `/api/actions`, `/api/savings/actions`, `/api/trades`, `/api/borrow`, or `/api/funding`; it applies the existing bearer/provider headers, no-store policy, redirect rejection, and account-owner race checks. `RecentMoneyActions` in `features/money-actions/recent-operations.tsx` renders durable operations with the shared `ActivityRow` and accepts indexed transaction hashes to deduplicate records already present in chain activity.

Base Account multi-call actions use the installed SDK provider's EIP-5792 `wallet_sendCalls` with `atomicRequired: true` and recover through `wallet_getCallsStatus`. CDP embedded accounts use one `sendUserOperation` call array and the prepared action id as the per-intent idempotency key. An ambiguous broadcast is recorded as `unknown`; refresh only inspects the stored operation reference and never calls either submission API again.

Attempt-aware command types (Phase 2 §3, not yet persisted) live in `apps/web/server/money-actions/attempt-commands.ts`. Locked provider facts: [attempt-aware onchain transactions](onchain-transaction-architecture.md#provider-specific-facts-and-unknowns).
