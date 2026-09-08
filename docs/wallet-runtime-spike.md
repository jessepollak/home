# Wallet runtime local spike

Status: local implementation spike, September 8, 2026.

Team/onboarding context: [architecture review](architecture-review-2026-09.md). This file remains the money-action contract.

Home money actions now use a server-issued prepare → review → atomic claim → user-wallet submission → receipt reconciliation lifecycle. The shared contract is `apps/web/features/money-actions/types.ts`; reviewed feature adapters issue plans through `issueMoneyAction`. Browsers submit only a prepared action id and immutable review hash. The server returns the canonical calls bound to the verified CDP subject, Base address, chain 8453, and selected account provider.

## Local-only persistence

The current durable store is a small Node-only `node:sqlite` adapter at `apps/web/server/money-actions/sqlite-store.node.ts`. It writes ignored runtime data to `apps/web/.local/home-money-actions.sqlite` when Next runs from the web workspace (or `.local/home-money-actions.sqlite` relative to the active process working directory), with directory mode `0700` and database mode `0600`. It stores action plans, immutable review hashes, owner tuples, statuses, attempts, and public chain/provider operation references. It stores no access tokens, signatures, emails, OTPs, private keys, or provider credentials.

**This SQLite adapter is local-spike persistence. It is not production persistence for Vercel** and is not multi-instance safe on serverless. Bun monorepo build settings and this blocker: [Vercel deploy](vercel-deploy.md). A production release still needs the reviewed deployment database described in [target architecture](target-architecture.md) (not the current tree); the `MoneyActionStore` boundary is injectable so that replacement does not change feature plan contracts or browser execution semantics. Neon/Postgres is not implemented here.

## Endpoints

- `POST /api/actions/send/prepare`: validates a send intent and issues the exact server-owned call plan.
- `POST /api/actions/:id/claim`: atomically creates the sole execution attempt. Repeated claims recover that attempt and never authorize another dispatch.
- `POST /api/actions/:id/submission`: attaches the same Base call-bundle, user-operation, and/or transaction reference; conflicting references are rejected. Transaction receipts are checked on Base, with EntryPoint sender/user-operation proof for embedded CDP accounts.
- `POST /api/actions/:id/status`: records only bounded wallet outcomes (`unknown`, `rejected`, or `failed`); it cannot claim confirmation.
- `GET /api/actions/:id`: reads and reconciles one owner-scoped operation without resubmitting.
- `GET /api/operations` and allowlisted alias `GET /api/actions/operations`: return recent operations for Activity composition, scoped to the full verified owner/provider/address/chain tuple.

Feature modules share `AccountWalletClient.fetchAccountResource(path, options)` instead of creating another SDK/auth context. The client accepts only same-origin paths under `/api/actions`, `/api/savings/actions`, `/api/trades`, `/api/borrow`, or `/api/funding`; it applies the existing bearer/provider headers, no-store policy, redirect rejection, and account-owner race checks. `RecentMoneyActions` in `features/money-actions/recent-operations.tsx` renders durable operations with the shared `ActivityRow` and accepts indexed transaction hashes to deduplicate records already present in chain activity.

Base Account multi-call actions use the installed SDK provider's EIP-5792 `wallet_sendCalls` with `atomicRequired: true` and recover through `wallet_getCallsStatus`. CDP embedded accounts use one `sendUserOperation` call array and the prepared action id as the per-intent idempotency key. An ambiguous broadcast is recorded as `unknown`; refresh only inspects the stored operation reference and never calls either submission API again.
