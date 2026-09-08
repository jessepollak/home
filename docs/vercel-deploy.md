# Vercel deploy (bun monorepo)

Status: operator build-settings note, September 8, 2026. How to import this repository on Vercel. **Not** a production authorization and **not** a hosted-database setup.

Home is a bun workspace (`workspaces: ["apps/*"]`). Install and build from the **repository root**. The Next.js app lives in `apps/web`; root scripts already change directory there (`bun run --cwd apps/web build`).

Current delivery: [build status](build-status.md). Local money-action persistence: [wallet runtime](wallet-runtime-spike.md). Neon/Postgres remains a [target architecture](target-architecture.md) destination — it is **not** implemented in this tree.

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

Browsing works without credentials. Email sign-in and authenticated money actions need **your** CDP project. Add each deployed origin (preview and production) to that project's allowed origins. Details: [CDP setup](cdp-setup.md).

Optional server-only `BASE_RPC_URL` is documented in [portfolio](portfolio.md); it is not in `.env.example`.

## Blocker: `node:sqlite` is not multi-instance safe

**A green Vercel build is not a public money-action deploy.**

`SqliteMoneyActionStore` (`apps/web/server/money-actions/sqlite-store.node.ts`) uses Node `node:sqlite` and writes a process-local file under `.local/` (typically `apps/web/.local/home-money-actions.sqlite` when Next runs from `apps/web`). That adapter is **local-spike only**.

On Vercel serverless it is not shared across instances, not durable across deploys or cold starts, and not safe for concurrent prepares/claims. Money actions on a public URL need a shared Postgres/Neon `MoneyActionStore`. **That store is not in this repository.** The `MoneyActionStore` port is injectable; replacing SQLite is a separate engineering PR. Do not treat [target architecture](target-architecture.md) as evidence that Neon/Drizzle is implemented.

Do not enable authenticated money actions on a public deploy until that shared store exists.

## Out of scope here

- Neon Marketplace, Drizzle, or any Postgres adapter
- CDP webhooks, migrations, or a Deploy button
- Production authorization or funded end-to-end smoke
