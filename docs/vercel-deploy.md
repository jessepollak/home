# Vercel deploy (bun monorepo)

Status: operator build-settings note, September 8, 2026. How to import this repository on Vercel and wire hosted money-action persistence. **Not** a production authorization.

Home is a bun workspace (`workspaces: ["apps/*"]`). Install and build from the **repository root**. The Next.js app lives in `apps/web`; root scripts already change directory there (`bun run --cwd apps/web build`).

Current delivery: [build status](build-status.md). Persistence: [wallet runtime](wallet-runtime-spike.md). Broader Neon/webhooks/`packages/*` destination: [target architecture](target-architecture.md).

## Project settings

Set these in the Vercel project (Build & Development / General). Keep **Root Directory** at the repository root so `bun.lock`, `packageManager`, and workspace install stay in scope.

| Setting | Value |
|---|---|
| Root Directory | Repository root (monorepo). Do not set this to `apps/web`. |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Output | Next.js app under `apps/web` (root `build` runs `next build` there) |
| Node.js | **22+** (`engines.node` is `>=22`). Local `node:sqlite` needs **22.13+**; the spike was validated on Node 24. |

Vercel detects bun from the root `bun.lock` and `packageManager: "bun@1.3.12"`. The default install is `bun install`. Override it to `--frozen-lockfile` so deploys match CI (`bun install --frozen-lockfile` then `bun check`).

If the import wizard suggests Root Directory `apps/web`, set it back to the repository root. There is no committed `vercel.json`; these dashboard overrides are enough. Framework preset: **Next.js**.

Start command for a local production server (not used by Vercel) is `bun start` → `bun run --cwd apps/web start`.

## Environment

Copy the names from the root [`.env.example`](../.env.example) into the Vercel project. Store real values only in Vercel env / gitignored `apps/web/.env.local`. Never commit secrets. Never give server keys a `NEXT_PUBLIC_` prefix.

| Variable | Required for | Notes |
|---|---|---|
| `NEXT_PUBLIC_CDP_PROJECT_ID` | Email sign-in | Public CDP project ID |
| `CDP_API_KEY_ID` | Server session validation | Server-only |
| `CDP_API_KEY_SECRET` | Server session validation | Server-only |
| `CDP_SQL_AUTH_MODE` | Indexed history | Default `client-api-key` |
| `CDP_SQL_CLIENT_API_KEY` | Indexed history in default mode | Server-only |
| `DISABLE_CDP_USAGE_TRACKING` | Privacy default | Unset or `true` keeps CDP SDK telemetry off |
| `DISABLE_CDP_ERROR_REPORTING` | Privacy default | Unset or `true` keeps CDP SDK error reporting off |
| `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT` | Optional SIWE path | Leave unset for email-only |
| `CODEX_API_KEY` | Optional Invest USD snapshots | Server-only |
| `DATABASE_URL` | Hosted money-action persistence | Neon pooled connection string. Leave unset for local `bun dev` (SQLite). Landing and browse can deploy without it; money-action routes fail closed without it. Server-only. |

Landing and browse can deploy without `DATABASE_URL`. Money-action routes fail closed without it. Browsing works without credentials. Email sign-in and authenticated money actions need **your** CDP project. Add each deployed origin (preview and production) to that project's allowed origins. Details: [CDP setup](cdp-setup.md).

Optional server-only `BASE_RPC_URL` is documented in [portfolio](portfolio.md); it is not in `.env.example`.

## Money-action store: SQLite XOR Postgres

Exactly one store is active per process. There is no dual-write.

| Runtime | Selection | Adapter |
|---|---|---|
| Local `bun dev` with `DATABASE_URL` unset | SQLite | `SqliteMoneyActionStore` (`node:sqlite`, `.local/`) |
| `DATABASE_URL` set | Postgres/Neon only | `PostgresMoneyActionStore` (`@neondatabase/serverless`) |
| Vercel without `DATABASE_URL` | Fail closed | Does **not** load `node:sqlite` |

`apps/web/server/money-actions/runtime-store.ts` selects the adapter. Hosted Turbopack builds alias the SQLite module to a stub so the serverless graph never loads `node:sqlite`. Tests keep using `setMoneyActionStoreForTests`. Feature plan contracts and browser execution are unchanged.

### Operator setup (Neon on Vercel)

1. Provision Neon in your Vercel project (Marketplace → Neon). That injects server-only `DATABASE_URL` (use the **pooled** connection for runtime).
2. Apply the schema once per database. Run `bun run money-actions:migrate` from local (or CI) with `DATABASE_URL` set — it is **not** part of the default Vercel build:
   ```sh
   bun run money-actions:migrate
   ```
   Equivalent SQL: `apps/web/server/money-actions/migrations/001_money_action_operations.sql` (Neon SQL editor also works). The hosted store applies the same `CREATE IF NOT EXISTS` statements on first use.
3. Confirm `DATABASE_URL` is set for Production and Preview. Do not set it in `.env.local` unless you intend to use Postgres instead of SQLite locally.
4. Redeploy. Hosted selection must not import `node:sqlite`.

The table stores action plans, immutable review hashes, owner tuples, statuses, attempts, and public chain/provider refs. It stores no access tokens, signatures, emails, OTPs, private keys, or provider credentials. Sensitive call data still expires from process memory.

This adapter is **not** production authorization. Do not enable authenticated money actions on a public deploy without `DATABASE_URL`, and do not treat a green build as a funded-wallet approval. CDP webhooks, Drizzle, and the rest of [target architecture](target-architecture.md) are still later work.

Optional live adapter tests (throwaway Neon branch only):

```sh
MONEY_ACTION_PG_TEST_URL=postgresql://… bun test apps/web/server/money-actions/store.test.ts
```

CI uses the in-process Postgres test double plus SQLite and Memory. It does not require `DATABASE_URL`.

## Out of scope here

- CDP webhooks or a Deploy button
- Drizzle / `packages/*` extraction
- Production authorization or funded end-to-end smoke
