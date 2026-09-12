# Checkpoint — September 12, 2026: Home is thin

State of `main` after the reset program. Read `home-is-thin.md` for the architecture; this file records where things stand and how to resume.

## State

- `origin/main` is green on all CI jobs (bun check, Chromium + WebKit smoke, real-Postgres contracts, delivery tests). Tag: `checkpoint/2026-09-12-home-is-thin`.
- `apps/web` unit suite: 676 tests, ~2.8s wall (Sept 11 morning: 1,221 tests, 37.5s). Test code ~22k LOC (was 40k).
- Product: the money-action and trading ledgers are gone (~20k LOC). One `actions` table (the unused `user_settings` was dropped later that day, decision D2); funding's tables unchanged. `home-experience.tsx` is 15 modules, none over 500 LOC.
- Delivery mode for this program: lanes on short branches, the coordinator merges fast-forwards to `main` after `bun check` and browser smoke pass on the integrated tree. No issues, labels, or PR rounds. Jesse reviews on `main`.

## Landed today (in order)

1. Test speed and hygiene: deterministic timers (#322, #323), source-text tests removed and fail-closed fetch in the DOM harness (#324), lint guardrails (#325), rAF cleanup (#334).
2. Reset (#333): `prepare → confirm → dispatch → handle`, CDP `idempotencyKey = action.id`, Base EIP-5792 `id = action.id`, derived status, one `ownerGeneration` fence, browser SDK imports restricted to `client/account`. Reviewed twice (design, post-integration); nits fixed.
3. Client data layer: TanStack Query with owner-prefixed keys, generation-bump cache clearing and per-owner persister, post-action fresh-balance loop (`?fresh=1`, rate-limited).
4. Shell: panels stay mounted; shallow `pushState` routing; `?flow=send&action=<id>` resumes an unconfirmed review from `GET /api/actions/:id`; inbound-intent allowlist; performance marks with a CI budget.
5. Recognized tokens on nested Balances (#337); money/locale formatting module (ICU-deterministic typography); `@home/ui` primitives, surfaces, 6px radii, press feedback, `MoneyTicker`; adoption across screens and components.
6. Test volume (#326): shared fixtures under `apps/web/tests/helpers`, one route contract test, UI tests trimmed to bug-guarding behavior.
7. Ported from the other session: activity copy, panel focus outline, Safari sheet anchoring with the WebKit smoke project, partial-label removal.
8. Docs: obsolete ledger docs deleted; `home-is-thin.md` gained client-architecture and performance rules; index rebuilt.

## Decisions taken without a live Jesse review (all in `home-is-thin.md`)

- `confirm` precedes dispatch; unconfirmed rows are invisible and lazily deleted after 1h. `pending` holds server-built calls and is cleared on confirm. `GET /api/actions/:id` returns `kind`; only `send` resumes.
- Wallet rejections are retryable; ambiguous failures are never re-dispatched.
- Ponder or any self-hosted indexer: no. CDP data APIs are the indexed source.
- A UI unit test survives only if it guards behavior that would be a bug; layout, copy, and motion are proven by the Playwright smoke.
- CI `balances:painted` budget is 3.5s (1s locally). Two WebKit motion assertions run only when the trace has enough frames; anchor geometry is always asserted.

## Open

- Jesse runs one real send and one savings deposit with a funded test wallet on the next deployment.
- Residual risks: CDP idempotency window unverified live; keys.coinbase.com duplicate-id behavior unverified (mitigated by never auto-retrying `wallet_sendCalls`); indexer latency bounds the `unknown` window (15 min / 24 h constants).
- Funding program (#15, #199, #282, #293, #294, #295) and Base Account work (#288) continue on their own cadence, untouched here. #289 (local Postgres via docker-compose) awaits Jesse.
- `docs/target-architecture.md` and `docs/product-scope.md` describe proposed, not current, structure.

## Resuming

Branch from `origin/main`, work in a worktree, run `bun check` and `bun run --cwd apps/web test:browser-smoke` on the integrated tree, fast-forward `main`. Postgres-backed tests read `ACTION_PG_TEST_URL` / `FUNDING_PG_TEST_URL` (local Homebrew Postgres works: `initdb`, `pg_ctl -o "-p 55432"`). Install Playwright browsers with `bun run --cwd apps/web test:browser-install`, never bare `bunx playwright`.
