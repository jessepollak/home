# Architecture review — growing the engineering team

**Date:** 2026-09-08  
**Scope:** Current `main` (`0d9db14` and parents). Read of `apps/web/`, `docs/`, `.github/workflows/ci.yml`, and root workspace scripts. No production refactor in this review.  
**Audience:** Founder + engineer #2. This is a hiring/onboarding contract, not a redesign.

**Current-state docs:** [build status](build-status.md), [wallet runtime spike](wallet-runtime-spike.md), [Vercel deploy](vercel-deploy.md), [docs index](README.md), [README](../README.md).  
**Target / archive (not the live tree):** [target architecture](target-architecture.md) (formerly `technical-design.md`), [archived implementation plan](archive/implementation-plan-2026-09-07.md). Product intent: [product scope](product-scope.md).

---

## A. Executive summary

- **Conditional go for engineer #2.** The money-action kernel is already a real contract (server-issued plans, owner tuple, atomic claim, immutable submission refs). A second engineer can ship in parallel *if* they stay in a feature lane and treat `apps/web/server/money-actions/` as a single-writer zone.
- **Do not hire #2 into “make this production-ready this week.”** Local `node:sqlite` plus an in-process sensitive-payload overlay is explicitly not multi-instance persistence. A Neon/Postgres `MoneyActionStore` now exists for `DATABASE_URL`; Drizzle/webhooks from [target architecture](target-architecture.md) are still later. Shipping a store without store-contract parity is the fastest way to double-dispatch.
- **The live app is a Bun monorepo with one Next.js app** (`apps/web`). There is no `packages/core`, `packages/db`, `lib/api`, TanStack Query, Zod, or `POST /api/webhooks/cdp`. The 2026-09-07 design that described that missing tree now lives at [target architecture](target-architecture.md); old `technical-design.md` / `implementation-plan.md` URLs are stubs.
- **Strongest existing pattern:** thin `app/api/*/route.ts` factories + injectable `MoneyActionStore` + session-derived owner. Browsers submit intents or `{ reviewHash }`, never call plans. Keep this.
- **Strongest safety tests already exist:** owner isolation, atomic claim (`dispatch` vs `recover`), immutable submission handles, and a Node SQLite race probe. CI runs `bun check` (372 passing unit/contract tests + lint + typecheck + build). Playwright auth and the SQLite probe are **not** in CI.
- **Fragile seams for two people:** `features/account/cdp-client.tsx` (~2,200 lines), `app/home-experience.tsx` (~840 lines), copied `parseAuthorizedSession` in six handlers, vault addresses duplicated in config vs Morpho, and no ESLint import-boundary rule. Features already import server modules (mostly types/config; a few runtime constants).
- **Money UI is deliberately not a protocol ledger.** Activity rows are Received/Sent/Self transfer. Valuation is wallet + three USDC vaults, explicitly “Borrow separate,” not net worth. Country selection is presentation, not eligibility.
- **Gates that remain real:** verified CDP session, provider credentials, stock eligibility, `cdp-embedded`-only trades, Borrow preview-only for undeployed accounts, hosted funding credentials, and “local SQLite ≠ production.” Local acceptance is not production authorization (`docs/build-status.md`).
- **Go conditions:** (1) assign non-overlapping lanes, (2) require the contribution contract below on every finance PR, (3) start from current-tree docs only (target architecture is demoted), (4) do not start a parallel coordinator or a second persistence implementation without a written cutover, (5) keep live funded probes opt-in and out of CI.

---

## B. Pattern catalog (keep)

These are working contracts. Document them; do not reinvent them when adding a feature.

### 1. Feature / server / thin-route split

| Layer | Path | Owns |
|---|---|---|
| Routes | `apps/web/app/api/**/route.ts` | `runtime = "nodejs"`, `dynamic = "force-dynamic"`, wire authorizer + handler |
| Pages / shell | `apps/web/app/*.tsx` | Compose features; `home-experience.tsx` is the Home shell |
| Features | `apps/web/features/*` | UI, parsers, client fetch helpers, shared money-action types |
| Server | `apps/web/server/*` | Session validation, prepare/issue, stores, RPC/SQL, receipts |
| Config | `apps/web/config/*` | Brand, regions, navigation, asset registries (no secrets) |

Example route (claim): `apps/web/app/api/actions/[id]/claim/route.ts` exports `POST = createClaimMoneyActionHandler({ authorize, validateBeforeClaim })`. Logic lives in `apps/web/server/money-actions/handlers.ts`.

There is **no** `apps/web/lib/`. Cross-cutting auth is `apps/web/server/cdp/` plus `apps/web/server/money-actions/session.ts`.

### 2. Injectable `MoneyActionStore`

- Interface: `apps/web/server/money-actions/store.ts` (`issue`, `claim`, `get`, `list`, `recordSubmission`, `updateStatus`).
- Test implementation: `MemoryMoneyActionStore` in the same file.
- Runtime selection: `apps/web/server/money-actions/runtime-store.ts` — `DATABASE_URL` → `PostgresMoneyActionStore`; else local `SqliteMoneyActionStore`. Vercel without `DATABASE_URL` fails closed and does not load `node:sqlite`.
- Test override: `setMoneyActionStoreForTests`.
- Both adapters implement this interface without changing feature plan contracts (`docs/wallet-runtime-spike.md`). Never dual-write.

Any new store method must land in **memory + SQLite (+ future Postgres)** in the same PR, with `store.test.ts` updated.

### 3. Server-issued plans; client never authors calldata

Prepare endpoints accept **intent fields only**:

| Feature | Client body | Server output |
|---|---|---|
| Send | `assetId`, `recipient`, `amountBaseUnits` | `POST /api/actions/send/prepare` |
| Savings | `kind`, `vaultAddress`, `amountBaseUnits` | `POST /api/savings/actions` |
| Borrow | `operation`, `amount`, `snapshotBlockHash` | `POST /api/borrow` |
| Trades | quote request, then `{ intentHash, signature }` | `POST /api/trades` → `POST /api/trades/:id/finalize` |
| Funding | `{ assetId: "usdc" }` | Onramp session — **not** a money action |

`issueMoneyAction` (`apps/web/server/money-actions/issue.ts`) binds `owner` from the verified session, normalizes calls, enforces exact approval caps, caps lifetime at 30 minutes, and computes `reviewHash` as SHA-256 of canonical JSON. Claim body is **only** `{ reviewHash }` (`handlers.ts`).

Client execution (`features/account/cdp-client.tsx` `executeMoneyAction`) uses **server-returned** `claim.action.calls`, not a client-held plan.

### 4. Owner tuple on every durable operation

```ts
// apps/web/features/money-actions/types.ts
type MoneyActionOwner = {
  subject: string;
  address: `0x${string}`;
  chainId: 8453;
  accountProvider: AccountProvider; // "cdp-embedded" | "base-account"
};
```

`sameMoneyActionOwner` (`store.ts`) compares all four fields (address lowercased). Store reads/writes that miss the tuple return `null` (404), including cross-user claims (`store.test.ts`: “scopes reads, claims, and submission references to the verified owner tuple”).

Identity is **never** taken from `?wallet=` or a client `userId`. Portfolio and activity tests reject attacker wallet query params (`server/portfolio/handler.test.ts`, `server/activity/handler.ts` allowlists only `to` + `cursor`).

### 5. Atomic claim: one dispatch, every refresh recovers

`store.claim`:

- `prepared` + matching owner/hash + not expired → `submitting`, `attemptCount = 1`, disposition `dispatch`.
- Any later claim → disposition `recover`, same attempt.
- SQLite uses `UPDATE ... WHERE status = 'prepared'` inside `BEGIN IMMEDIATE`.

Client recover path (`cdp-client.tsx`): if `claim.disposition === "recover"`, poll existing refs and **do not** call `sendUserOperation` / `wallet_sendCalls` again. CDP embedded uses `idempotencyKey: canonicalAction.id`.

### 6. Session boundary before provider work

`createSessionHandler` (`server/cdp/session.ts`):

1. Reject missing/malformed `Authorization` **before** calling CDP.
2. Read `X-Home-Account-Provider`.
3. Validate token via CDP; derive `subject` and address only from the provider response.
4. Private cache headers: `Cache-Control: private, no-store`, `Vary: Authorization, X-Home-Account-Provider`.

Money-action routes re-parse via `readAuthorizedMoneyActionSession` and require `smartAccount.chainId === 8453`.

### 7. One client fetch helper, allowlisted paths

`AccountWalletClient.fetchAccountResource` (`features/account/cdp-client.tsx`) accepts only same-origin paths under `/api/actions`, `/api/savings/actions`, `/api/trades`, `/api/borrow`, `/api/funding`. It attaches bearer + provider headers, `cache: "no-store"`, `redirect: "error"`, and aborts on `transferBoundaryKey` change (account switch).

Do not add a second SDK/auth context inside a feature.

### 8. Registry-driven assets and presentation ≠ eligibility

| Registry | Path | Rule |
|---|---|---|
| Regions / 19 currencies / 39 countries | `apps/web/config/regions.ts` | Country changes presentation; `fundingStatus: "disabled"` on candidates |
| Invest assets | `apps/web/config/invest-assets.ts` | Stocks `availability: "restricted"` |
| Portfolio inventory | `apps/web/config/portfolio-assets.ts` | Native ETH + USDC + 11 invest + EURC/IDRX + 3 vaults; `assertPortfolioRegistry()` |
| Navigation | `apps/web/config/navigation.ts` | Home / Save / Invest only (Borrow is a linked page, not primary nav) |
| Morpho vault allowlist | `apps/web/server/morpho/config.ts` | `isConfiguredMorphoVault()` |
| Borrow market | `apps/web/server/borrowing/config.ts` | One cbBTC/USDC market |

Ticker is never identity. Asset keys are `eip155:8453/erc20:<lowercase>` or native.

### 9. Valuation and Activity composition (labels, not protocol)

- **Balances:** `GET /api/portfolio` → `features/portfolio`.
- **Valuation:** `GET /api/portfolio/valuation?region=` → `server/portfolio/valuation.ts`. Exact fraction math (`server/valuation/math.ts`). Omissions include `bounded-inventory`. Home copy: “Wallet and savings only · Borrow separate” (`app/home-experience.tsx`).
- **Activity:** CDP SQL transfers labeled Received / Sent / Self transfer (`features/activity/activity-panel.tsx`). Coverage note excludes native ETH and complete ERC-4337 history. Indexed activity is **not** receipt confirmation.
- **Home operations:** `RecentMoneyActions` (`features/money-actions/recent-operations.tsx`) lists durable operations and dedupes by transaction hash already shown in Activity.

Do not add Morpho/Borrow protocol names onto Activity rows to “make it richer.” That mixes ledgers.

### 10. Test layers (keep the split)

| Layer | How to run | In CI? |
|---|---|---|
| Unit/contract (`apps/web/**/*.test.ts(x)`, 82 files, 372 pass + 1 skip) | `bun test` | Yes, via `bun check` |
| Production-component Chromium auth, mocked SDK (7 scenarios) | `bun run --cwd apps/web test:browser-auth` | **No** |
| SQLite claim/shared-bundle/race probe | `node scripts/probe-money-actions-sqlite.mjs` (see script header) | **No** |
| Live Morpho / CDP SQL | `MORPHO_LIVE_SMOKE=1`, `CDP_SQL_SMOKE=1` | **No** (correct) |

Highest-value existing tests to copy: `server/money-actions/store.test.ts`, `issue`/`handlers` tests, portfolio/activity wallet-scope tests, valuation exact-math tests.

### 11. Gates and fixtures

- Env template: `.env.example`. Real secrets only in gitignored `apps/web/.env.local`.
- Base Account: `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT` must match server `isBaseAccountEnabled` on every authenticated route.
- Trades: server rejects `accountProvider !== "cdp-embedded"` (`server/trading/handler.ts`, `prepare.ts`, `finalize.ts`).
- Borrow: undeployed accounts stay `preview-only`.
- Demo/fixture money must never enter a live portfolio (technical design invariant; still correct — there is no `bun dev:demo` yet).

---

## C. Risks and gaps (fix soon)

Priority: **P0** = money-safety or “#2 will do the wrong thing in week 1.” **P1** = will cause collisions or silent security drift. **P2** = quality / later production.

| ID | Priority | Problem | Why it hurts a 2-person team | Fix size | Owner lane |
|---|---|---|---|---|---|
| R1 | P0 | ~~Technical design / product scope presented as live architecture.~~ **Addressed in docs:** target design is [target-architecture.md](target-architecture.md); the 2026-09-07 plan is [archived](archive/implementation-plan-2026-09-07.md); old paths are stubs. Residual risk is someone ignoring the current-tree path. | Engineer #2 scaffolds `packages/*` or Neon mid-feature if they skip [docs/README.md](README.md). | S (done) | eng |
| R2 | P0 | Default persistence is a single-node SQLite file + **in-process** sensitive swap calldata (`SqliteMoneyActionStore` / `MemoryMoneyActionStore` `sensitiveActions` map). Unique indexes on raw submission columns were **dropped**; only `verified_execution_key` is unique. | Two instances (or a premature Vercel deploy) split-brain claims. A second engineer adding “just Postgres” beside SQLite can double-dispatch. | L (Postgres adapter + cutover) / S (write the “do not deploy money actions multi-instance” rule) | eng |
| R3 | P0 | Shared money-action kernel is small and load-bearing: `store.ts`, `sqlite-store.node.ts`, `issue.ts`, `handlers.ts`, `status-transitions.js`, `app/api/actions/[id]/claim/route.ts`. Claim route always injects `validateTradeBeforeClaim`. | Two people editing claim/disposition/status in the same week can ship a second dispatch or block every feature. | S (ownership rule) | eng / TPM |
| R4 | P1 | `parseAuthorizedSession` (or equivalent) is copied in portfolio, valuation, activity, funding, trading, morpho positions, plus a stricter `readAuthorizedMoneyActionSession`. | One loosened copy becomes an auth bypass; easy to miss in review. | M | eng |
| R5 | P1 | No import-boundary enforcement. `eslint.config.mjs` is default Next only. Features already import `@/server/*` (types, Morpho config constants, Codex public contract). | A `"use client"` file that imports `server/cdp/provider` or a SQL client pulls secrets into the browser. No CI guard. | S–M | eng |
| R6 | P1 | `cdp-client.tsx` (~2202 lines) and `home-experience.tsx` (~839 lines) are merge magnets. Almost every finance UI change touches one of them. | Parallel PRs conflict; reviews become “did we regress sign-out / claim / refresh?” | M | eng |
| R7 | P1 | Vault addresses live in both `config/portfolio-assets.ts` (`portfolioVaults`) and `server/morpho/config.ts` (`MORPHO_V1_CANDIDATE_ADDRESSES`). Same three addresses today; no cross-file assertion. | Two people add a vault in one file only → valuation and savings disagree. | S | eng |
| R8 | P1 | CI is `bun check` only. Playwright auth (7 mocked Chromium scenarios) and `scripts/probe-money-actions-sqlite.mjs` are manual. Memory-store tests can pass while SQLite races regress. | #2 will trust green CI as “money-action safe.” It is not the full local gate described in build-status. | S | eng |
| R9 | P1 | `GET /api/transfer-receipt` requires auth but does **not** bind `hash`/`sender` to the session owner (`server/transfers/handler.ts`). Any signed-in user can probe an arbitrary tx. | Inconsistent with every other private route; a “small receipt helper” can become an enumeration API. | S | eng |
| R10 | P1 | Trade intent store (`server/trading/sqlite-intent-store.node.ts`) is a **second** SQLite database, independent of money actions. Finalize reserves `actionId` then claim re-validates. | Engineer A changes finalize binding; engineer B changes claim validator → stranded swaps or skipped pre-claim checks. | M | eng |
| R11 | P1 | No `CONTRIBUTING`, no `SECURITY`, no documented feature-lane map. README says “design feedback and focused PRs are welcome” but not how to pick a slice. | #2 will start in a hotspot or add a generic `/api/actions/prepare`. | S | TPM / eng |
| R12 | P2 | Status `included` exists in types and `status-transitions.js` but HTTP handlers never write it; receipt jumps toward `confirmed`. | Two people “completing” lifecycle semantics will fight the UI (`recent-operations.tsx`). | S | eng |
| R13 | P2 | Pre-claim freshness exists for swaps only. Send/save/borrow are pinned at prepare (TTL 5–30 min). | Two tabs can claim a stale-but-unexpired plan. Safer than double-dispatch; still surprising in review. | M | eng |
| R14 | P2 | Funding is a hosted onramp session, not a money action. No webhook handler. | Easy to invent a second operation ledger for “pending add money.” | M | eng |
| R15 | P2 | Activity is transfer-direction labels; Home operations are a separate list. Coverage is incomplete by design. | Pressure to “just show Morpho deposits in Activity” will double-count or mislabel. | S | design / eng |
| R16 | P2 | Target stack (Neon, Drizzle, webhooks, CDP SQL as history source of record, `packages/*`) is still the right *production* destination — but it is a later cutover, not parallel scaffolding. | Building unused packages now creates two sources of truth. | L | eng / TPM |

**Suggested sequencing:** R1 + R11 (docs — this PR), then R5 + R7 + R8 (guardrails, no product change), then R4 + R6 (collision reduction), then R2 as an explicit persistence milestone — not a drive-by.

---

## D. Contribution contract for new engineers

Print this. Use it as the PR checklist.

### How to pick a slice

1. Read [build-status.md](build-status.md) and [wallet-runtime-spike.md](wallet-runtime-spike.md) before [target-architecture.md](target-architecture.md). Target docs are the **destination**, not the tree.
2. Pick **one** vertical: one feature directory + its `server/<same>` + its `app/api/<same>` routes. Do not “clean up” the kernel in the same PR.
3. If the change needs a new `MoneyActionStore` method, a new status, or a change to claim/submission semantics — **stop** and treat it as a kernel PR owned by one person.
4. Prefer slices that can be proven with `MemoryMoneyActionStore` + fixtures. Live funded transactions are not a PR requirement and must not be added to CI.

### Directory ownership (stay in your lane)

| Lane | Own these | Ask before touching |
|---|---|---|
| Transfers | `features/transfers/`, `server/money-actions/prepare-send.ts`, `app/api/actions/send/` | `store.ts`, `handlers.ts`, `cdp-client.tsx` execution |
| Savings | `features/savings/`, `features/savings-actions/`, `server/savings-actions/`, `server/morpho/`, `app/api/savings/` | `config/portfolio-assets.ts` vault list (pair with Morpho config) |
| Invest / prices | `features/invest/`, `server/market-data/`, `app/api/market-prices/` | `config/invest-assets.ts` (fans out to portfolio + activity) |
| Trading | `features/trading/`, `server/trading/`, `app/api/trades/` | Claim route `validateBeforeClaim`, `issue.ts` reserved ids |
| Borrow | `features/borrowing/`, `server/borrowing/`, `app/borrow/`, `app/api/borrow/` | Valuation (must stay excluded), navigation |
| Funding | `features/funding/`, `server/funding/`, `app/fund/`, `app/api/funding/` | Do not invent a second operations table |
| Activity / valuation | `features/activity/`, `features/portfolio/`, `features/portfolio-valuation/`, `server/activity/`, `server/portfolio/`, `server/valuation/` | Presentation labels; do not net Borrow into Cash |
| Auth / session | `features/account/` (except dumping more into `cdp-client.tsx`), `server/cdp/` | Every authenticated route’s authorizer wiring |
| Landing / chrome | `features/landing/`, `components/`, `app/globals.css`, `config/brand.ts`, `config/navigation.ts` | Finance copy that implies eligibility or completeness |
| Persistence milestone | `server/money-actions/store.ts` + both implementations | Everything else — this is a dedicated cutover |

`app/home-experience.tsx` is shared composition. Prefer passing content props (`docs/ui-direction.md`) over editing the shell for feature work.

### Required tests before a finance PR

- [ ] `bun test` covers the new branch (handler + prepare/issue or parser).
- [ ] If you touched `MoneyActionStore` or SQLite/Postgres schema: `store.test.ts` (Memory + SQLite + Postgres contract) **and** `scripts/probe-money-actions-sqlite.mjs`.
- [ ] If you touched auth/session: a test that a client-supplied wallet/user id cannot change scope.
- [ ] If you touched a route: `app/api/<route>/route.test.ts` still asserts Node runtime, `force-dynamic`, and unauthenticated rejection before provider calls.
- [ ] If you touched valuation math or amounts: exact bigint/decimal fixtures; no `Number` for token amounts.
- [ ] `bun check` green. Do not enable `MORPHO_LIVE_SMOKE`, `CDP_SQL_SMOKE`, or funded-wallet secrets in CI.

Browser-auth (`test:browser-auth`) is required when you change sign-in, sign-out, or session restore — even if CI does not run it yet.

### Money-safety invariants (non-negotiable)

1. **Never double-dispatch.** Claim is the only grant of `dispatch`. Refresh/recover/read/status must not call wallet submit APIs again.
2. **Never accept client-authored call plans.** No API takes `calls[]` or a `MoneyActionDraft` from the browser for execution.
3. **Never authorize from a client user id or `?wallet=`.** Scope = verified CDP subject + smart-account address + chain `8453` + `X-Home-Account-Provider`.
4. **Never confirm from the client.** `POST /api/actions/:id/status` may set `unknown | rejected | expired | failed` only. Confirmation requires receipt + `verifiedExecution`.
5. **Never keep a SQL/SQLite transaction open across a provider call.**
6. **Never treat an ambiguous broadcast as retryable with a new nonce.** Record `unknown`; reconcile from the stored reference.
7. **Never use JS floats for token amounts, debt, or settlement.** Parse once at the boundary; reject excess precision.
8. **Never count the same position twice** (vault shares ≠ wallet USDC; Borrow is not Cash; Activity hash dedupe vs Home operations).
9. **Never infer eligibility from country, language, or UI copy.** Presentation registries ≠ execution gates.
10. **Never commit secrets or point previews at a shared production DB.** SQLite under `.local/` is local-spike only.
11. **Exact approvals only** (`issue.ts` `assertExactApprovalCaps`). No unlimited allowances.
12. **Same idempotency key + different payload fails.** Duplicate action id with a different plan throws `duplicate-money-action`.

### How to add a new money-action kind

1. Add the kind to `features/money-actions/types.ts` (`MoneyActionKind`).
2. Write `server/<feature>/prepare.ts` that builds a `MoneyActionDraft` from a **validated intent** (allowlisted contracts, amounts, chain).
3. Call `issueMoneyAction(session, draft)` — do not persist plans yourself.
4. Add a thin `app/api/<feature>/route.ts` with `createSessionHandler` / `createMoneyActionSessionAuthorizer`.
5. Drive the UI through `prepareMoneyAction` / `executeMoneyAction` / `MoneyActionReview`.
6. Extend `fetchAccountResource` allowlist **only if** you added a new `/api/...` prefix.
7. Add handler tests with `MemoryMoneyActionStore` via `setMoneyActionStoreForTests`.

Do **not** add `POST /api/actions/prepare` as a generic dump. Feature-specific prepare routes are the pattern.

### Doc update expectations

| You changed | Also update |
|---|---|
| A delivered feature or gate | [build-status.md](build-status.md) row + remaining gate |
| Money-action endpoints or store semantics | [wallet-runtime-spike.md](wallet-runtime-spike.md) |
| A production-destination decision (Postgres, webhooks, packages) | [target-architecture.md](target-architecture.md) |
| Navigation, valuation labels, eligibility copy | [ui-direction.md](ui-direction.md) and this review if the contract changed |
| A new country/asset | Registry + tests; do not enable funding because a candidate exists in `docs/stablecoin-candidates.json` |

Do not silently “complete” a chunk in the [archived implementation plan](archive/implementation-plan-2026-09-07.md). That file is a historical slice plan; build-status is the scoreboard.

### Gates and fixtures

- Use `.env.example` keys only. Never commit `apps/web/.env.local`.
- Missing optional credentials → integration unavailable with a useful error (see activity `ACTIVITY_NOT_CONFIGURED`). An explicitly live path must not fall back to demo balances.
- Inject stores/readers in handler factories; do not reach into SQLite from a test.
- Public routes (`/api/market-prices`, `/api/savings/vaults`) stay cacheable and secret-free. Private routes stay `private, no-store`.

---

## E. Suggested first-week backlog for engineer #2

Small, reviewable PRs that exercise good seams. None require a live funded transaction.

1. **Extract one session parser** (`S–M`). Replace the six `parseAuthorizedSession` copies with `server/cdp/authorized-session.ts`. Table-driven tests: malformed JSON → 503, provider header mismatch → fail closed, `?wallet=` ignored. Does not change product behavior.

2. **Import-boundary guard** (`S`). ESLint restriction or a `bun test` that fails if `features/**` runtime-imports `@/server/**` outside an allowlist (`import type` + `server/market-data/codex/public-contract` + documented config constants). Prevents secret leakage before it happens.

3. **Registry sync contract** (`S`). Assert `portfolioVaults[].address` equals `MORPHO_V1_CANDIDATE_ADDRESSES` (order-independent, lowercased) and that `assertPortfolioRegistry()` still bounds 3 vaults / 11 invest assets. Stops silent inventory drift.

4. **SQLite probe in CI** (`S`). Add a workspace script that runs `scripts/probe-money-actions-sqlite.mjs` and call it from `.github/workflows/ci.yml` (or `bun check`). Memory-store green will no longer be the only claim proof.

5. **Playwright auth in CI** (`S`). Run `test:browser-auth` on GitHub Actions with mocked boundaries (already how the suite works). Install Chromium in the workflow; no CDP secrets. Protects sign-in/out while #2 touches account UI.

6. **Store-contract parity** (`S`). Parameterize `server/money-actions/store.test.ts` so the same cases run against `MemoryMoneyActionStore` and `SqliteMoneyActionStore` (temp file). This is the rehearsal for a future Postgres adapter.

7. **Bind or document transfer-receipt scope** (`S`). Either require `sender` to match the session smart account, or rename/document the route as “authenticated public-chain probe” and add a test that states that. Removes an inconsistent private API.

8. **Split money-action execution out of `cdp-client.tsx`** (`M`, one PR, no behavior change). Move `executeMoneyAction` / recover / `assertMoneyActionDispatchable` to `features/money-actions/execute.ts` (or similar) and keep `cdp-client.tsx` as session + `fetchAccountResource`. Unblocks parallel feature PRs.

**Defer:** Drizzle cutover, CDP webhooks, `packages/*` extraction, generic action framework, live funded send, stock eligibility, extra Borrow markets, Venice/Rain. Those are production milestones, not onboarding exercises. The Neon money-action adapter is selected with `DATABASE_URL`; local `bun dev` stays on SQLite.

---

## Appendix — current tree vs target docs

```text
/workspace                    # Bun workspaces: ["apps/*"]
  apps/web                    # the entire product
    app/                      # Next pages + thin API routes
    features/                 # account, activity, borrowing, funding, invest,
                              # landing, money-actions, portfolio,
                              # portfolio-valuation, savings, savings-actions,
                              # trading, transfers, formatting
    server/                   # activity, borrowing, cdp, chain-data, funding,
                              # market-data, money-actions, morpho, portfolio,
                              # savings-actions, trading, transfers, valuation
    config/                   # regions, assets, navigation, brand
    tests/browser/            # Playwright auth (not in CI)
  docs/                       # current-state first; target + archive demoted
  scripts/                    # opt-in probes (cdp-sql, sqlite)
  .github/workflows/ci.yml    # bun install --frozen-lockfile && bun check
```

**Missing vs [target architecture](target-architecture.md) (intentional so far, not forgotten checkboxes):** `packages/core`, `packages/db`, `packages/config`, `packages/integrations`, `apps/web/lib/api`, `infra/`, `content/locales/`, `examples/`, `POST /api/webhooks/cdp`, `GET /api/capabilities`, generic `POST /api/actions/prepare`, `bun dev:demo`, `bun doctor`.

**Implemented beyond the 2026-09-07 chunk plan:** durable send + savings deposit/withdraw + email-controlled swaps + one Borrow market + valuation + Activity + funding handoff — all behind gates, all on local SQLite.

---

## Appendix — merge hotspots (coordinate, don’t both edit)

1. `apps/web/features/account/cdp-client.tsx`
2. `apps/web/app/home-experience.tsx`
3. `apps/web/server/money-actions/{store,sqlite-store.node,issue,handlers}.ts`
4. `apps/web/app/api/actions/[id]/claim/route.ts`
5. `apps/web/config/portfolio-assets.ts` + `apps/web/server/morpho/config.ts`
6. `apps/web/config/invest-assets.ts`
7. `apps/web/components/finance-rows.tsx` + `apps/web/app/globals.css`

---

## Review method

Read (not assumed from docs): money-action store/issue/handlers/session/runtime, CDP session, activity/portfolio/valuation/funding/trading/borrowing handlers, `cdp-client.tsx` execution path, feature→server imports, ESLint config, CI workflow, test file counts (`82` `*.test.ts(x)`, `1` Playwright file), `.env.example`, and the docs listed in the header. Discarded: “the monorepo already has packages/core,” “webhooks exist,” “Postgres is wired,” “CI includes browser-auth,” “Activity shows protocol labels,” “valuation is net worth.”
