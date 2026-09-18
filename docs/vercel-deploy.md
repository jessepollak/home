# Vercel deploy (bun monorepo)

This is an operator build-settings note, not production authorization.

## Home application: `home-web`

The existing `home-web` Vercel project uses **Root Directory** `apps/web`; Vercel runs `bun run build` there, which is `bun run db:migrate && next build`, so migrations run in the production build step (the gate skips previews and unset `DATABASE_URL`).

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework preset | Next.js |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Node.js | 22+ |

### Pre-release production access

Home can place a replaceable shared deployment-access gate before customer authentication. Set `HOME_ACCESS_REQUIRED=1` and configure the server-only `HOME_ACCESS_PASSWORD` with at least 32 UTF-8 bytes. This credential and the `home-access` cookie are independent from Home customer sessions and any future administrator session; passing the gate never identifies or authorizes a customer, administrator, support agent, or configuration change.

Keep Vercel Authentication enabled while deploying and verifying the gate. After authorized verification, change **Project Settings → Deployment Protection** to exactly **Only Preview Deployments**. This keeps previews behind Vercel Authentication and removes it only from production so the public Apple association file and signed webhook endpoints can reach Home. Roll back by restoring Vercel Authentication for production; do not widen the application's public-route allowlist.

Before that setting change, an operator must configure cross-instance Vercel Firewall rate-limit rules for failed access submissions and unauthenticated cost-bearing endpoints, including `POST /api/access`, `POST /api/auth/base/nonce`, `POST /api/auth/base/verify`, and `/api/market-prices/history`. Home intentionally has no in-memory or database rate limiter for this deployment boundary. Firewall configuration, protected-deployment checks, and WAF inspection are privileged operator actions, not CI proof.

After the setting change, the operator runs unauthenticated live probes for the exact Apple file, protected pages and APIs, and rejected CDP/funding webhook deliveries, then separately verifies deployment access, Home sign-in, Home sign-out, and access logout. These live probes must record the deployment and commit without recording the shared credential. Local tests and preview evidence do not establish that production, Deployment Protection, Firewall, or webhook delivery was verified.

### Skew Protection

For the Vercel project `home-web`, **Project Settings → Advanced → Skew Protection** is enabled with a 12-hour max age.

Next exposes the serving deployment ID to client code, and Home adds it as the `x-deployment-id` header on client requests to `/api/*`. No environment variable is required. We use the explicit header rather than the alternative experimental `experimental.useSkewCookie` option.

Verify against a preview after an older deployment passes the configured max age:

```sh
# Set <old dpl id>, <current dpl id>, and <preview> from the Vercel preview deployments.
curl -sI -H "x-deployment-id: <old dpl id>" https://<preview>/api/market-prices    # 404 (expected; verify once on a preview)
curl -sI -H "x-deployment-id: <current dpl id>" https://<preview>/api/market-prices # 200
```

## Storybook workshop: separate `home-storybook` project

Storybook must use a separate Vercel project; it is not another output of `home-web`. The intended `home-storybook` settings are:

| Setting | Value |
| --- | --- |
| Owner and source | Same Vercel team as `home-web`; GitHub repository `jessepollak/home` |
| Root Directory | `apps/web` |
| Framework preset | Other |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build-storybook` |
| Output Directory | `storybook-static` |
| Production Branch | `main` |
| Git integration | Current-main production deployment and a distinct, immutable preview deployment for each PR head |
| Deployment protection | Vercel Authentication on production and previews, unless Jesse chooses a stricter existing convention |
| Environment variables | None; do not copy Home, provider, wallet, or database variables |

Do not add `apps/web/vercel.json`: both projects share that root, so a repository-level override could change the production Home application. Per-project Vercel settings are the isolation boundary. Project creation, team ownership, Git integration, and deployment protection are privileged Jesse actions; these documented settings do not claim that `home-storybook` or any hosted URL exists.

When this project is created before Storybook reaches `main`, the initial production deployment from `main` is expected to fail because that branch does not yet contain the Storybook build script. Keep **Production Branch** set to `main`; create or trigger the PR-head preview instead of temporarily treating the feature branch as production. After merge, verify that the first `main` deployment succeeds before calling current-main hosting complete.

A review reference records the project owner, relevant settings, commit SHA, deployment-specific URL, and direct [manager and canvas story links](design-system.md#component-workshop). Do not use a moving branch or project alias as the approval reference. Protected hosted access is operator-only under the [browser-validation contract](browser-validation.md); credential-free local start and static build are the separate reproduction path.

After Jesse provisions the project, verify without weakening protection:

- From `main`, confirm the deployment identifies the current `main` commit and opens a manager link and its canvas link at the deployment-specific URL.
- From a PR, confirm Git integration creates a different preview tied to the current PR-head commit; select stories, change mobile/desktop viewports, and exercise the dialog from both manager and canvas links.
- Push a new PR head and confirm it creates a new deployment-specific URL. Refresh current-head evidence rather than reusing the older preview.
- Confirm Vercel Authentication protects both production and preview access and that an authorized operator can open them.
- Confirm the project has no Home/provider/database environment variables, and record exact limitations or failed checks rather than claiming hosted acceptance.

## Environment

Copy names from [`.env.example`](../.env.example); keep values in Vercel or gitignored `apps/web/.env.local`. Never expose server keys with `NEXT_PUBLIC_`. The legacy `FUNDING_SANDBOX` flag is rejected. Keep `COINBASE_ONRAMP_MODE`, `PEER_OFFRAMP_MODE`, and the currently unused generic sandbox override `FUNDING_SANDBOX_CLIENT_IP` unset on production Vercel; Coinbase Embedded Orders does not consume that override.

Actions and balance observations require server-only `DATABASE_URL`; Home connects to PostgreSQL via `pg`, so Neon works as a regular Postgres database; keep `?sslmode=require` (or `verify-full`) in the URL and use Neon's pooled hostname on Vercel. The production build runs `bun run db:migrate` automatically before Next.js builds, so there is nothing to run by hand. Preview and development deployments skip migrations even when `DATABASE_URL` is present because previews currently share the production database; this remains the safe default until Neon preview branches land in [#403](https://github.com/jessepollak/home/issues/403). `HOME_MIGRATE_ON_BUILD=1` is an emergency explicit override. Configure server-only `BASE_RPC_URL` for hosted Base reads. Email sign-in requires the CDP project ID plus server validation keys. See [CDP setup](cdp-setup.md) for allowed origins.

## Neon preview branches

Vercel-Managed and Neon-Managed integrations name preview database branches `preview/<git-branch>` ([Neon branch cleanup](https://neon.com/docs/guides/vercel-branch-cleanup)). Two workflows manage them, and both no-op (exit 0) without repository secret `NEON_API_KEY` and `NEON_PROJECT_ID` configured as a repository variable or secret, so forks without Neon stay green:

- `.github/workflows/neon-preview-cleanup.yml` deletes `preview/<head_ref>` when a PR closes. This is the primary path.
- `.github/workflows/neon-preview-prune.yml` runs every 15 minutes as an aggressive safety net for Neon Free's 10-total-branch cap. It deletes the oldest `preview/*` branches until the count is below the exclusive `keep_below` threshold. The default is 6, so the newest five preview branches survive, leaving `main + five previews = six total`: four slots under the 10-branch cap. It never deletes `main`, `production`, default, protected, or non-`preview/*` branches.

Ordering is oldest-first, so once six `preview/*` branches exist the scheduled prune can delete the preview database of a still-open, older PR even while that PR's Vercel preview stays up. That is accepted policy under the 15-minute cadence, not a bug; PR-close cleanup remains the primary path. Manual runs use the workflow's `keep_below` (exclusive threshold) and `dry_run` (list deletions without calling DELETE) inputs.

## CDP balance activity webhook

Configure `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` in production. On the first authenticated balance read for an address, Home automatically finds an enabled `wallet_activity` subscription for Base mainnet and this deployment, adds the address when there is room, or creates a new subscription and stores its one-time signing secret in PostgreSQL. Production targets `https://${VERCEL_PROJECT_PRODUCTION_URL}/api/webhooks/cdp`; `HOME_WEBHOOK_ORIGIN` optionally overrides the public HTTPS origin for another managed environment. Registration is disabled without `DATABASE_URL` because an ephemeral instance cannot retain the signing secret.

Confirm registration through the `balances-webhook-subscription` server events and by listing webhook subscriptions with the CDP CLI/API. Then send a real test delivery, confirm `/api/webhooks/cdp` returns 200, and confirm the next authenticated balance read fully re-observes. A missed delivery remains bounded by the 120-second balance backstop.

Funding origin and client-IP derivation trust Vercel to own `x-forwarded-host`, `x-forwarded-proto`, and `x-forwarded-for`. Do not expose a bare `next start` server directly to untrusted clients without a proxy that overwrites those headers.

The action contract is [Actions](actions.md) under [Architecture](architecture.md): Home records confirmed actions, while CDP/Base and Base receipts provide execution status. A green deployment does not authorize a real-money launch.
