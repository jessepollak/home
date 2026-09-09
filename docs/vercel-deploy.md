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

Empty commits can skip preview rebuilds in this monorepo (Vercel reports "Not affected"). After Neon prune frees preview DB slots, retrigger with a no-op docs touch or Vercel Redeploy — not an empty commit.

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
5. If PR preview builds fail at Neon’s branch cap, add the GitHub Actions credentials in [Neon preview branch cleanup](#neon-preview-branch-cleanup-github-actions) and prune stale `preview/*` branches.

The table stores action plans, immutable review hashes, owner tuples, statuses, attempts, and public chain/provider refs. It stores no access tokens, signatures, emails, OTPs, private keys, or provider credentials. Sensitive call data still expires from process memory.

This adapter is **not** production authorization. Do not enable authenticated money actions on a public deploy without `DATABASE_URL`, and do not treat a green build as a funded-wallet approval. CDP webhooks, Drizzle, and the rest of [target architecture](target-architecture.md) are still later work.

Optional live adapter tests (throwaway Neon branch only):

```sh
MONEY_ACTION_PG_TEST_URL=postgresql://… bun test apps/web/server/money-actions/store.test.ts
```

CI uses the in-process Postgres test double plus SQLite and Memory. It does not require `DATABASE_URL`.

## Neon preview branch cleanup (GitHub Actions)

Vercel PR previews provision a Neon branch per Git branch. Neon Free caps a project at **10 branches**. Stale `preview/*` branches from the Vercel Neon integration count toward that cap and can fail new preview builds (`BUILD_FAILED`, “Resource provisioning failed”, empty logs). Production is unaffected.

Two GitHub Actions workflows keep preview branches under the cap. They use GitHub-hosted runners only (no AI). They do not change app code and are not part of `bun check`.

### Required GitHub configuration

| Name | Type | Where |
|---|---|---|
| `NEON_API_KEY` | Repository **secret** | Settings → Secrets and variables → Actions → Secrets |
| `NEON_PROJECT_ID` | Repository **variable** | Settings → Secrets and variables → Actions → Variables |

Create an API key in the Neon Console: **Account settings → API keys** (personal) or the organization **Settings → API keys**. A project-scoped key is enough if the project lives in an org. See [Manage API keys](https://neon.com/docs/manage/api-keys).

Find the project ID on the Neon Console **Project Settings** page.

Until both are set, the workflows log a skip message and **exit 0**. Forks and clones without Neon stay green. `NEON_PROJECT_ID` may also be a secret; the variable is what [Neon documents](https://neon.com/docs/guides/vercel-branch-cleanup).

### Workflows

1. **PR-close cleanup** (`.github/workflows/neon-preview-cleanup.yml`) — on `pull_request` `closed`, deletes `preview/<git-branch>` with [`neondatabase/delete-branch-action@v3`](https://github.com/neondatabase/delete-branch-action). That name is what the Vercel integration creates (`preview/${{ github.head_ref }}`). See [Managing preview branch cleanup](https://neon.com/docs/guides/vercel-branch-cleanup). Already-gone branches are a no-op.

2. **Safety-net prune** (`.github/workflows/neon-preview-prune.yml`) — daily cron plus **Actions → Prune Neon preview branches → Run workflow**. Lists branches via the [Neon API](https://api-docs.neon.tech/reference/listprojectbranches). If the `preview/*` count is **≥ 8**, deletes the **oldest** preview branches (by `created_at`) until the count is **< 8**. Leaves headroom under Free’s 10 (which includes `main`). Never deletes `main`, production, default, protected, or any non-`preview/*` branch. No-op under the threshold. Optional `dry_run` lists deletions without calling DELETE.

### Assumptions

- Vercel-Managed and Neon-Managed integrations name preview DBs `preview/<git-branch>` ([Neon docs](https://neon.com/docs/guides/vercel-branch-cleanup)). Only those names are eligible for deletion.
- Neon Free includes 10 branches per project. Keeping `preview/*` below 8 leaves room for new PR previews.
- Oldest-first prune may remove a still-open PR’s preview DB if 8+ preview branches exist. Closing PRs is the primary cleanup path.
- Archived preview branches still count toward the cap; the prune deletes them too when they match `preview/*`.

### One-time cleanup if already at 10/10

If Neon Console already shows 10/10 branches, add the secret and variable, then either delete stale `preview/*` branches in the Console or run **Prune Neon preview branches** from the Actions tab (try `dry_run` first). After there is headroom, redeploy an open PR preview to confirm provisioning succeeds.

## Out of scope here

- CDP webhooks or a Deploy button
- Drizzle / `packages/*` extraction
- Production authorization or funded end-to-end smoke
