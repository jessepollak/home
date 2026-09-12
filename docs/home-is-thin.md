# Home is thin

Jesse-locked direction, September 11, 2026. Revised after independent design review (September 12). This supersedes `docs/architecture-review-2026-09.md` sections B.2 (injectable `MoneyActionStore`), B.4 (owner tuple on every durable operation), B.5 (atomic claim), "Required tests before a finance PR", and "Money-safety invariants". Where the two disagree, this document wins.

## Principle

Home is a Next.js UI plus a small server over CDP (embedded wallet), Base Account, the Base chain, and our funding providers. Wallets, signing, user operations, idempotency, and settlement are the providers' job. The chain is the ledger of record. Home persists only what a provider cannot give back to us.

Nothing is live today. The database is disposable. We choose the smallest thing that is correct; we do not migrate.

## What Home owns

1. Screens, presentation, formatting. Token amounts are `bigint` from the boundary in; never `Number`.
2. Calldata issuance. The server builds every call plan (send, savings deposit/withdraw, trade, borrow) with exact approvals. The browser never authors calls. This deletes the client-side `sendTransfer` fallback (`cdp-money-action-execution.ts` ~L1021-1100, `send-dialog.tsx`, `shared/transfers/transfer-helpers.buildTransferCall`, the connector's `eth_sendTransaction`).
3. Auth scope. A request acts only for the verified CDP subject or Base SIWE address, its smart account, chain 8453, and the declared provider. Client-supplied user ids and `?wallet=` never widen scope.
4. One owner fence (rules below).
5. A thin record of user-initiated actions, so a confirmed action survives reload and shows in Activity before the indexer catches up.
6. User settings.
7. Funding orders and provider integrations (`server/funding`, untouched by this reset).

## What Home does not own (delete)

- The money-action state machine: attempt states, claims and dispositions, admission-release, evidence and data-migration tables, `status-transitions`, the Postgres cutover flag, the SQLite spike, `runtime-store` selection, the localStorage provider-handle journal and cross-tab lock, 409 candidate races, and the "Check status" recovery flows.
- The trading intent ledger: `intent-store`, `runtime-intent-store`, `preclaim`, and the intent half of `finalize`. The Permit2 signature append/verify half of `finalize.ts`, `permit2.ts`, `signer.ts`, and `balance.ts` stay.
- Routes: `the former per-action claim endpoint`, `/admission-release`, `/status`, `/submission`, `the former actions-operations endpoint`, `the former operations endpoint`, `the former trade-finalize endpoint` (replaced below).
- Any test whose subject is one of the above, deleted in the same commit as the code.

## Data model

Neon Postgres stays. Deliberate durable state is `actions`, funding's provider tables, and `schema_migrations`, which exists only to make the single `bun run db:migrate` command idempotent. One shared executor `server/db/sql.ts` serves both. Native Base SIWE challenges are stateless: the signed HttpOnly challenge cookie carries the address, origin, message hash, nonce, issue time, and five-minute expiry, so authentication creates no database row.

```sql
create table actions (
  id                 uuid primary key,          -- CDP idempotencyKey and EIP-5792 id
  owner_key          text not null,             -- verified subject + smart account + provider
  provider           text not null,             -- 'cdp-embedded' | 'base-account'
  kind               text not null,             -- 'send' | 'savings-deposit' | 'savings-withdraw' | 'trade' | 'borrow' ...
  summary            jsonb not null,            -- what to render: amounts, asset, target, label
  pending            jsonb,                     -- server-built calls and (trades) permit fields for unconfirmed actions; cleared on confirm
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz,               -- set by POST /confirm; unconfirmed rows are invisible
  provider_handle    text,                      -- CDP userOperationHash, or the EIP-5792 id (= id) for Base
  transaction_hash   text,                      -- resolved by the client from provider status; server verifies via receipt
  handle_recorded_at timestamptz
);
create index actions_owner_recent on actions (owner_key, confirmed_at desc) where confirmed_at is not null;

```

- No `status` column and no `plan_hash` (the server never observes the dispatch, so a hash enforces nothing). Status is derived at read time:
  - `confirmed_at` null → not shown; lazily deleted after 1h by `GET /api/actions`.
  - confirmed, no `transaction_hash`, younger than 15 min → `pending`; older → `unknown` (never "not sent"); `unknown` rows without a hash are dropped from Activity after 24h because they can never be matched to a chain row.
  - `transaction_hash` set → server checks the receipt; the chain row wins **status**, the action `summary` wins **kind and label** (a savings deposit is "USDC → 0xVault" on chain; Home says "Deposited to Savings").
- Balance caching: the client presentation cache and the server's in-memory TTL caches are enough. No database caching until a portfolio-history chart needs `portfolio_snapshots(owner_key, taken_at, payload jsonb)`.
- Ponder or any self-hosted indexer: no. Home's data is defined by users, not contracts; CDP SQL API and Token Balances already provide indexed data as a service. Revisit only if Home ships its own contracts or CDP's data APIs hit a measured limit.

## Flow

1. `POST /api/actions/prepare` `{kind, params}` → server verifies scope, builds calldata, inserts an unconfirmed `actions` row, and stores the draft calls in `pending` for every kind. It returns `{id, calls, summary, expiresAt}`. Trades return `{id, summary, permit2Typed, expiresAt}` and additionally store the permit hash, swapCallIndex, and quote expiry in `pending`.
2. Client shows review. `GET /api/actions/:id` is owner-scoped and returns the unconfirmed summary plus `pending.calls`, so a reload mid-review can resume. On confirm: `POST /api/actions/:id/confirm` (sets `confirmed_at`, returns the final `calls`, and clears `pending`; for trades the body carries the Permit2 `signature`, the server verifies the signer is the owner and splices it — this is the kept half of `finalize`). The client dispatches only on 2xx. Reload-resume is intended only before confirm; after confirm the tab owns dispatch and any live retry.
3. Dispatch: CDP `sendUserOperation({ idempotencyKey: id, calls })` → `provider_handle = userOperationHash`. Base `wallet_sendCalls({ id, calls, atomicRequired: true })` → `provider_handle = id`, prefilled at confirm.
4. `POST /api/actions/:id/handle` `{providerHandle}` and later `{transactionHash}` once the client resolves it from `getUserOperation` / `wallet_getCallsStatus`. Retried while the tab lives; late posts are accepted. Only the client can query provider status (end-user credentials); the server derives only from receipts.
5. `GET /api/actions` returns the owner's confirmed rows (last 24h) with derived status; Activity = chain activity ∪ those rows, deduped by `transaction_hash`. `RecentMoneyActions` and `transfer-actions.tsx` read this route.

Retry semantics, verified against the installed SDKs:
- **Shared rule:** an explicit user rejection is definitely not submitted by that invocation. Return a typed `rejected` result, evict only that rejected dispatch promise, and permit another user-initiated attempt in the same tab. An ambiguous provider or transport failure stays cached and is never dispatched again.
- **CDP:** `sendUserOperation` is one `POST …/smart-accounts/{addr}/send` carrying `X-Idempotency-Key` (`@coinbase/cdp-core` web build; `@coinbase/cdp-api-client`). Prepare, sign, and broadcast happen inside CDP under that key; a replay with the same id returns the identical `userOperationHash`. Replay is therefore the handle-recovery path while the tab lives. The body must be byte-identical (the wallet secret id changes after re-auth); treat `idempotency_error` as sent-unknown and stop. An explicit SDK user cancellation (`MfaError` with `CANCELLED`) is retryable; a transport abort or other ambiguous failure is not. There is no lookup-by-key or list endpoint, so a lost handle after the tab dies stays `unknown` until the chain shows it.
- **Base Account:** the SDK forwards `wallet_sendCalls` to the popup unchanged; there is no SDK-side dedup, and duplicate-id behavior at keys.coinbase.com is unverified. A provider `4001`, normalized to `BaseAccountConnectorError("cancelled")`, is retryable. Any ambiguous failure remains single-dispatch; `wallet_sendCalls` is not invoked again automatically.

## Owner fence

One `ownerGeneration` counter replaces the four-field fence in `cdp-session-lifecycle.tsx`. It is sufficient with these rules:
1. It is a synchronous `useRef`, never React state.
2. It is captured at prepare and re-checked before every provider call and every server POST, not only on results.
3. It bumps on sign-in, sign-out, provider switch, Base `accountsChanged` / `chainChanged` / `disconnect`, and loss of server-session verification.
4. Sign-out awaits SDK cleanup before a new sign-in may begin.

## Client architecture

- Use TanStack Query for remote client state. Every private key starts with the owner key; clear the query client and persisted owner cache on every owner-generation bump.
- Keep the shell mounted. Flows are shallow-routed and URL-addressable; resumed Send is `?flow=send&action=<id>`.
- Parse inbound URLs through one allowlist. Unknown panels, flows, assets, and action IDs do nothing.
- After a confirmed action, invalidate balances, valuation, Activity, positions, Borrow, and actions so the normal freshness loop refetches them.
- Render money only through `MoneyTicker` and the shared formatting module; features do not format amounts independently.

## Performance

- Startup gate: verified session plus wallet address renders the shell with cached balances; every other surface streams in afterward.
- Frame budget: never call `setState` for each pointer move or price tick. Use transforms, opacity, motion values, or imperative text writes.
- Mark `shell:paint`, `session:verified`, `wallet:ready`, `balances:painted`, and `action:first-interactive`; CI budgets `balances:painted`.

## Failure modes we accept

- Send succeeded, handle post lost, tab closed: the row reads `unknown`; Activity shows the transfer when indexed; the row ages out at 24h.
- Owner switch mid-flight: the generation fence drops the work before the next call.
- Provider outage: show the provider's error; there is no local state to reconcile.
- Indexer latency bounds the `unknown` window; measure it on preview and tune the 15 min / 24h constants.

## Test policy

- Test Home's logic: calldata issuance (exact approvals and amounts), auth scope, amount parsing and formatting, derived status (table-driven), the owner fence, and UI behavior that would be a bug if broken.
- Never re-test CDP, Base Account, Next, motion, or happy-dom. Layout, copy, spacing, and animation are proven by the Playwright smoke on the preview.
- No real sleeps; no assertions on source-file text; permutation matrices are table-driven and bounded; one behavior per test.
- Heuristic, not gate: a PR's test code should not exceed its product code; status derivation and amount parsing legitimately invert it. Suite budget is set after measuring the post-reset suite, then enforced.

## Gate for the reset PR

1. `bun check` green; the Postgres CI job is repurposed to run the new schema (`actions`, `user_settings`) plus funding's stores against a real Postgres — not deleted, it is the only real-Postgres job.
2. Behavioral contract test stubbing cdp-core's transport: exactly one `POST …/send` with `X-Idempotency-Key === action.id` per confirm, including after a resolve-then-throw retry.
3. Playwright with `smoke-fixture-provider.tsx` (already counts dispatches): `sendUserOperation` resolves-then-throws once → dispatch count 1 after retry, handle recorded, row shows `pending`.
4. Fence test: prepare generation ≠ confirm generation → zero provider calls, zero server POSTs.
5. Table-driven derived-status test; typecheck; grep proves the deleted route strings are gone from client and docs.
6. Vercel preview; Jesse completes one send and one savings deposit with a funded test wallet; one fresh review scoped to double-send, calldata authorship, cross-user leakage, and amounts.

## Deletion and edit list

Server: `server/money-actions/{postgres-store,runtime-store,status-transitions,store-contract,store,provider-submission-contract,migrate}.ts`, `server/money-actions/migrations/*`, the claim/submission/status/admission-release/operations routes, `server/trading/{preclaim,intent-store,runtime-intent-store}.ts`, the intent half of `finalize.ts` and its route, `scripts/delivery/tests/postgres-money-action*.test.ts` (replaced by tests for the new schema), `the former money-action migration command` script, `the former money-action cutover flag`. `app/api/activity/route.ts` stops probing the store and reads `GET /api/actions`' reader.

Client: `client/money-actions/{provider-handle-journal,provider-handle-recovery}.ts`, `tests/provider-handle-recovery.test.ts`; the client-authored transfer fallback (above); `client/account/cdp-money-action-execution.ts` rewritten around the flow (target ≤ 300 LOC from 1,215); `client/account/cdp-session-lifecycle.tsx` reduced to sign-in/out/restore plus the fence (from 1,418); `base-account-connector.ts` keeps connect, sign, `wallet_sendCalls`, `wallet_getCallsStatus` and drops journal-driven recovery.

Keep: `server/funding/*`, `server/cdp/session.ts`, `server/auth/*`, `server/money-actions/{issue,prepare-send,receipt}.ts` builders and receipt verification, `server/trading/{permit2,signer,balance,prepare,cdp}.ts`, savings/borrow calldata builders, `server/activity`, `server/chain-data`, `server/portfolio`, all presentation. Trades keep their current hosted availability; this reset does not change whether swaps are enabled.

Docs: this file replaces superseded money-action sections in `architecture-review-2026-09.md`. Related operator docs are `docs/fork-and-extend.md`, `docs/vercel-deploy.md`, and `docs/integrations/README.md`. Invariants shrink to five: server-authored calldata; verified scope; `bigint` amounts; `idempotencyKey` / EIP-5792 id = action id; owner-generation fence.

## Residual risks (verify on preview, once)

- CDP idempotency window (documented 24h) and same-key-different-body behavior are documented, not observed live.
- keys.coinbase.com duplicate-id behavior for `wallet_sendCalls` is unverified; mitigated by never auto-retrying.
- Indexer latency is unmeasured.
