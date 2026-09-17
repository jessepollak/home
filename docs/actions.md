# Actions

Subsystem design under [architecture.md](architecture.md), Jesse-locked September 11, 2026 and revised September 12. Architecture owns the cross-cutting principles, client architecture, performance rules, and test policy; this document owns the action contract.

An action is the onchain flow: Home prepares calldata, the user signs, Home tracks one id to a receipt. The `actions` table is a **record** (architecture.md principle 2): a confirmed action is the one thing a provider cannot give back to Home.

## Data model

Neon Postgres stays. The full table inventory is in [architecture.md](architecture.md#data-model); this document owns `actions`. Native Base SIWE challenges are stateless: the signed HttpOnly challenge cookie carries the address, origin, message hash, nonce, issue time, and five-minute expiry, so authentication creates no database row.

```sql
create table actions (
  id                 uuid primary key,          -- CDP idempotencyKey and EIP-5792 id
  owner_key          text not null,             -- verified subject + smart account + provider
  provider           text not null,             -- 'cdp-embedded' | 'base-account'
  kind               text not null,             -- 'send' | 'savings-deposit' | 'savings-withdraw' | 'trade' | 'borrow' ...
  summary            jsonb not null,            -- what to render: amounts, asset, target, label, typed product metadata
  pending            jsonb,                     -- server-built calls and (trades) permit fields for unconfirmed actions; cleared on confirm
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz,               -- set by POST /confirm; unconfirmed rows are invisible
  provider_handle    text,                      -- CDP userOperationHash, or the wallet-returned EIP-5792 bundle id for Base
  transaction_hash   text,                      -- resolved from provider status (client, or server reconciliation for Base); server verifies via receipt
  handle_recorded_at timestamptz
);
create index actions_owner_recent on actions (owner_key, confirmed_at desc) where confirmed_at is not null;

```

- No `status` column and no `plan_hash` (the server never observes the dispatch, so a hash enforces nothing). Status is derived at read time:
  - `confirmed_at` null → not shown; lazily deleted after 1h by `GET /api/actions`.
  - confirmed, no `transaction_hash`, younger than 15 min → `pending`; older → `unknown` (never "not sent"); `unknown` rows without a hash are dropped from Activity after 24h because they can never be matched to a chain row.
  - `transaction_hash` set → server checks the receipt; the chain row wins **status**, the action `summary` wins **kind and label** (a savings deposit is "USDC → 0xVault" on chain; Home says "Deposited to Savings").
- Balances are an observation, not a record; their table and rules live in [balances.md](balances.md).
- Ponder or any self-hosted indexer: no. Home's data is defined by users, not contracts; CDP SQL API and Token Balances already provide indexed data as a service. Revisit only if Home ships its own contracts or CDP's data APIs hit a measured limit.

## Flow

1. `POST /api/actions/prepare` `{kind, params}` → server verifies scope, builds calldata, inserts an unconfirmed `actions` row, and stores the draft calls in `pending` for every kind. Borrow summaries also store typed operation and market identity so compound actions render without title parsing. It returns `{id, calls, summary, expiresAt}`. Trades return `{id, summary, permit2Typed, expiresAt}` and additionally store the permit hash, swapCallIndex, and quote expiry in `pending`.
2. Client shows review. `GET /api/actions/:id` is owner-scoped and returns the unconfirmed summary plus `pending.calls`, so a reload mid-review can resume. On confirm: `POST /api/actions/:id/confirm` (sets `confirmed_at`, returns the final `calls`, and clears `pending`; for trades the body carries the Permit2 `signature`, the server verifies the signer is the owner and splices it — this is the kept half of `finalize`). The client dispatches only on 2xx. Reload-resume is intended only before confirm; after confirm the tab owns dispatch and any live retry.
3. Dispatch: CDP `sendUserOperation({ idempotencyKey: id, calls })` → `provider_handle = userOperationHash`. For Base Account only, confirm estimates the exact finalized ordered Coinbase smart-account `executeBatch` against `latest`, applies bounded headroom, and returns the optional aggregate budget. Estimation or capability failure is non-blocking and simply omits the hint. The Base connector maps a present budget to `capabilities.gasLimitOverride.value` on only the final `wallet_sendCalls` call; calls and request fields are otherwise unchanged. Base `wallet_sendCalls({ id, calls, atomicRequired: true })` → `provider_handle` = the bundle id the wallet returns (not the request `id`; Base generates its own, and `wallet_getCallsStatus` only accepts that one). Provider and canary verification remain required because keys.coinbase.com honoring this call-level override as a full-batch budget is not yet verified.
4. `POST /api/actions/:id/handle` `{providerHandle}` and later `{transactionHash}` once the client resolves it from `getUserOperation` / `wallet_getCallsStatus`. Retried while the tab lives; late posts are accepted. CDP status is readable only with end-user credentials, so the server derives CDP rows from receipts alone; Base handles can also be reconciled server-side (below).
5. `GET /api/actions` returns the owner's confirmed rows (last 24h) with derived status; Activity = chain activity ∪ those rows, deduped by `transaction_hash`. `RecentMoneyActions` and `transfer-actions.tsx` read this route.

For Base Account rows whose client stopped after recording a provider handle, owner-scoped action reads wait through a short client grace period and then ask the Coinbase Wallet status RPC (`BASE_ACCOUNT_STATUS_RPC_URL` override for tests/staging) for that handle. A completed response can fill the missing transaction hash before the normal Base receipt check; provider failures, malformed responses, conflicts, and timeouts leave the stored action unchanged. These reconciliation calls are status-only and never recreate, alter, or dispatch calldata; CDP embedded rows are not reconciled by the server.

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

## Failure modes we accept

- Send succeeded, handle post lost, tab closed: the row reads `unknown`; Activity shows the transfer when indexed; the row ages out at 24h.
- Owner switch mid-flight: the generation fence drops the work before the next call.
- Provider outage: show the provider's error; there is no local state to reconcile.
- Indexer latency bounds the `unknown` window; measure it on preview and tune the 15 min / 24h constants.

## Constants

| Constant | Value | Why |
|---|---|---|
| Unconfirmed row retention | 1 h | a draft the user never confirmed is noise; deleted lazily by `GET /api/actions` |
| Confirmed without hash → `unknown` | 15 min | bounds how long "pending" can be claimed without provider evidence |
| Hashless `unknown` dropped from Activity | 24 h | can never be matched to a chain row |
| Post-action hot window (balances) | 60 s | set by `/confirm` and `/handle`; see [balances.md](balances.md) |

## Unverified assumptions (verify on preview, once)

Balances-side assumptions (CDP Token Balances index lag after a send, CDP Node request budget, `wallet.activity.multi` payload and address packing) live in [balances.md](balances.md).

- CDP idempotency window (documented 24h) and same-key-different-body behavior are documented, not observed live.
- keys.coinbase.com duplicate-id behavior for `wallet_sendCalls` is unverified; mitigated by never auto-retrying.
- Indexer latency is unmeasured.
