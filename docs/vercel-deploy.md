# Vercel deploy (bun monorepo)

Follow this path to launch your own instance, finish Admin setup, and maintain it. It is not production or real-money authorization. Use the [operator checklist](operator-checklist.md) for instance-specific values and provider configuration.

## Launch

1. **Fork Home on GitHub.** A fork keeps the upstream relationship for later updates. The [README deploy button](../README.md#deploy-your-own) instead copies Home into a new repository and sets Root Directory; it neither provisions a database nor sets the Install Command.
2. In Vercel, choose **Add New → Project**, import your fork, and apply these settings. Check the Install Command even if you used the button.

   | Setting | Value |
   | --- | --- |
   | Root Directory | `apps/web` |
   | Framework preset | Next.js |
   | Install Command | `bun install --frozen-lockfile` |
   | Build Command | `bun run build` |
   | Node.js | 22+ |
   | Fluid compute | Enabled (Project Settings → Functions) |

   The build runs `bun run db:migrate && next build`. With `DATABASE_URL` set, production builds apply migrations; non-production Vercel builds skip them unless explicitly enabled. See [Environment](#environment) before configuring previews.
3. **Attach PostgreSQL separately.** Add the Neon integration from the Vercel Marketplace and connect its database to the Home project, or paste your own server-only `DATABASE_URL` into Vercel environment settings with `sslmode=require` (or `verify-full`). Use Neon's pooled hostname on Vercel. Database provisioning is an operator step, not something Home or the deploy button does. Keep scratch and preview databases separate from production.
4. Generate a session secret on your own device, for example `openssl rand -base64 32`. Paste it only into the Home project's Vercel environment settings as server-only `HOME_SESSION_SECRET`; it must be at least 32 UTF-8 bytes. Never put it in Git, a public form, or evidence.
5. Obtain the **Base smart-account address** of each administrator and set server-only `HOME_OPERATOR_ADDRESSES` in Vercel to a comma-separated list of unique `0x` addresses with 40 hex characters. Use the account that will sign in with Base Account, not a different wallet or an email-sign-in account. If you do not know its address, deploy with the session secret first, sign in with **Continue with Base Account**, and open **Account** from the Home header or desktop sidebar (`/home?account=settings`). In its **Account** section, select the address under the Basename or **Base account**, then choose **Copy address** in the full-address popover. This control uses the signed-in smart-account address. Copy only that address into the allowlist, not session responses or cookies. Opening `/api/session` directly is not an address lookup: native Base sessions require the `X-Home-Account-Provider: base-account` request header. This is the verified session described in [Base Account sign-in](base-account.md#manual-user-smoke); it requires no transfer. Until the allowlist is configured, Admin remains denied.
6. **Redeploy** after setting the environment variables. Sign in with Base Account on the deployed Home origin, open `/admin`, and use **Overview → Setup**. If a separate deployment-access gate is enabled, pass it first; it does not make you an administrator.

### First-run Setup

Required checks are **Session signing** (`HOME_SESSION_SECRET`, at least 32 UTF-8 bytes), **Administrators** (`HOME_OPERATOR_ADDRESSES`), and **Database** (`DATABASE_URL`). The database check only verifies a connection and the presence of `schema_migrations` and `operator_settings`; it is not a check that every migration is current.

| Setup state | Meaning and recovery |
| --- | --- |
| Missing | A required variable is unset. Set it in Vercel environment settings, redeploy, and return to Admin. For Database, attach PostgreSQL and set `DATABASE_URL`. |
| Invalid | A configured value fails its format check. Correct the session secret or administrator list, redeploy, and return. An unset or invalid allowlist denies all Admin access, so fix it in Vercel rather than through Admin. |
| Unavailable | The database is configured but its check failed. Check the connection URL, database availability, network access, and credentials; redeploy if the environment changed, then reload Admin. |
| Needs migration | The database connected, but a required table is missing. Redeploy production to apply migrations, or run `DATABASE_URL=<database-url> bun run --cwd apps/web db:migrate` against the intended database from a private operator environment. Then reload Admin. Never run this against production from an unrelated preview. |
| Ready | The variable checks passed, or the database connected with the required tables present. This does not verify optional provider connections or authorize production use. |

Leaving Home to change Vercel settings, redeploying, and reloading `/admin` recomputes progress; there is no saved wizard state. There is **no public setup wizard or first-user administrator**. Optional checks — **Email sign-in**, **Hosted RPC**, **Prices**, **Secrets keyring**, and **Funding quotes** — do not block required setup. A credential marked **set** is not a verified provider connection; follow that provider's enablement checks before use.

Setup links to **General settings** (`/admin/settings`), **Products and markets** (`/admin/settings/products`), and **Money in and out** (`/admin/settings/funding`). Review these before offering new entries. **Running version** shows the commit, branch, environment, and deployment ID from `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_ENV`, and `VERCEL_DEPLOYMENT_ID`. Without a valid commit SHA it says **Build metadata is absent**; do not infer a running commit from a moving branch name.

## Update, backup and recovery

### Update a fork

1. Record the full running commit and deployment ID from **Admin → Overview → Running version**. In your local fork, add the upstream remote once, fetch, and inspect the changes before merging or deploying:

   ```sh
   git remote add upstream https://github.com/jessepollak/home.git
   git fetch upstream
   git diff --name-only <running-commit>..upstream/main -- apps/web/server/db/migrations apps/web/server/funding/migrations .env.example apps/web/shared/operator-settings/contract.ts
   ```

   If `upstream` already exists, verify its URL rather than adding it again. Review the actual diff, not just filenames, including any settings domain definitions imported by the contract. Check migrations, new environment requirements, and each domain's `schemaVersion`. There is no generic migration-compatibility gate. If Running version lacks metadata, establish the serving deployment's commit in Vercel before proceeding.
2. **Before merging or running any merge validation**, take a backup and rehearse its restore using the steps below. Keep the pre-update settings metadata so you can compare it after deployment.
3. Merge `upstream/main` into your fork's deployment branch with `git merge upstream/main`. Resolve conflicts while preserving intentional local changes and review the resolved diff against the running commit. Run `bun check` with `DATABASE_URL` unset or pointing only at a local/isolated scratch database, **never the serving database**. The check includes the app build, which applies migrations when `DATABASE_URL` is set, including values loaded from `apps/web/.env.local`; `env -u DATABASE_URL` alone does not prevent that file from supplying it. Use `DATABASE_URL="" bun check` to explicitly disable database access, or explicitly supply the isolated scratch URL. Only then push to a branch that auto-deploys.
4. Deploy the reviewed merge with the [launch settings](#launch). Confirm Admin → Running version shows the expected merged commit and deployment ID. Run `db:settings-fingerprint` again and confirm settings revisions and `valueSha256` hashes are unchanged unless an explicitly reviewed change required otherwise. The full fingerprint should match for a same-schema update with no settings or audit changes; applied migrations or new audit entries change the full fingerprint, so compare those separately with the expected changes. Do not accept an unexplained difference.

### Backup and restore rehearsal

Use PostgreSQL client tools compatible with your database. Set `SOURCE_DATABASE_URL` and `SCRATCH_DATABASE_URL` privately; never record their values. Capture the source metadata close to the backup, while settings and audit metadata are stable:

```sh
DATABASE_URL="$SOURCE_DATABASE_URL" bun run --silent --cwd apps/web db:settings-fingerprint
TZ=UTC pg_dump --format=custom --file home-before-update.dump "$SOURCE_DATABASE_URL"
TZ=UTC bun run --silent --cwd apps/web db:backup-check -- --file home-before-update.dump --max-age-hours 24
```

Alternatively, record the database provider's restore point and its time, then rehearse the provider's restore flow. A provider restore point is not a dump file and is not checked by `db:backup-check`.

`db:backup-check` inspects a custom-format dump with `pg_restore --list` without connecting to a database. It prints JSON metadata and a status line. `--silent` prevents Bun from echoing the full dump path. The default age limit is 24 hours; age uses the older of archive creation time and file modification time, so touching or copying a dump cannot make an old archive look fresh. JSON reports both `archiveCreatedAt` and `modifiedAt`. The archive header records wall-clock time without a reliable zone: run both `pg_dump` and `db:backup-check` with `TZ=UTC`. A header whose time cannot be parsed reports `unreadable` rather than falling back to file modification time.

| Outcome | Exit | Next step |
| --- | --- | --- |
| recent | 0 | Readable archive with required settings and migration entries within the age limit; rehearse its restore. |
| stale | 1 | Archive exceeds the age limit; take a fresh backup before updating. |
| missing | 2 | File is absent or empty; create a backup. |
| unreadable | 3 | Archive cannot be inspected or required entries are missing; check the file, format, permissions, and availability of `pg_restore`, then create or check a valid backup. |

**A readable artifact or provider restore point is not a verified restore.** Restore into an isolated scratch database or Neon branch, never production and never a preview sharing production's database. For an empty scratch database:

```sh
pg_restore --exit-on-error --no-owner --dbname "$SCRATCH_DATABASE_URL" home-before-update.dump
DATABASE_URL="$SCRATCH_DATABASE_URL" bun run --silent --cwd apps/web db:settings-fingerprint
```

For a provider restore point, use the provider's restore-to-new-database/branch flow instead. Compare the source snapshot taken at backup time with the scratch result. `db:settings-fingerprint` uses a read-only transaction and emits JSON: migration count/latest, each settings domain's `schemaVersion`, `revision`, `updatedAt`, and `valueSha256`, audit count, and an aggregate `fingerprint`. It does not print settings values. Missing `DATABASE_URL` exits 2; connection or query failure exits 3. A matching result checks this metadata, not every restored table or external service; investigate differences before updating.

Keep the dump private: it contains customer data and may contain sealed secrets. Record only non-secret metadata in evidence: commit, deployment ID, migration count/latest, settings fingerprint/revisions/hashes, audit count, and backup-check JSON with a non-sensitive filename. Never record database URLs, customer records, cookies, provider credentials, or encryption keys.

A local rehearsal exercised a custom-format dump and isolated restore with 29 migrations, one saved regions setting, and one audit entry. Source and scratch metadata matched, as did a same-schema migration rerun. That is not hosted launch, Vercel rollback, provider-restore, or production recovery verification.

### Application rollback

Use **Vercel Instant Rollback** to return to a previous production deployment only after checking the diff between the running and target commits shows **no database migration and no settings `schemaVersion` change**. Check imported domain definitions too, retain the same database/keyring, and review the [secrets-at-rest rollback restriction](secrets-at-rest.md#balance-webhook-signing-secrets). Otherwise stop: an application rollback does not undo database changes, and older code rejects a stored settings schema version higher than it knows, causing that domain to fail closed. No generic gate proves backward compatibility.

Before rolling back, follow the [funding rollback caveat](operator-checklist.md#roll-back): corridors paused only in saved settings can reopen in older releases; removing provider credentials can strand open orders by stopping status refresh and webhooks. Do not remove them while those orders remain open. After rollback, reload Admin and confirm **Running version** shows the restored older commit and expected deployment ID, then compare the settings metadata again. If the target predates Running version, stop rather than claiming this confirmation succeeded.

### Database recovery

Database recovery requires **explicit approval from whoever owns the instance**. Restore the chosen backup or restore point to a **new database or Neon branch**, verify it in isolation, then repoint Vercel's `DATABASE_URL` and redeploy compatible application code. Do not overwrite production as a rehearsal or recovery shortcut.

Keep the same `HOME_SECRET_*` keyring, including the current and previous keys and key version needed by the restored rows, so sealed rows stay readable; follow [Secrets at rest](secrets-at-rest.md) for rotation and recovery limits. Never export keys into evidence. Confirm Running version and the restored settings metadata after redeployment. **Onchain transactions and provider events are not undone by a database restore**; reconcile them separately before resuming operations.

## Home application

Use the [Launch settings](#launch) for the Home application project. The following sections cover platform behavior and additional protections.

### Database pool lifecycle

The server opens its PostgreSQL pools (`max: 5`, 30-second idle timeout, 10-second connect timeout) and attaches each pool it opens to the platform lifecycle hook, so an idle Fluid instance stays alive long enough for `pg` to close idle connections before it suspends. Fluid compute stays enabled for that hook to do anything; without it connections die with the instance. The hook holds one idle wait per instance, so a later pool's attach supersedes an earlier pool's pending wait, and that pool's idle connections can still die with the instance — the same as running without the hook.

### Pre-release production access

Home can place a replaceable shared deployment-access gate before customer authentication. Set `HOME_ACCESS_REQUIRED=1`, configure the server-only `HOME_ACCESS_PASSWORD` with at least 8 UTF-8 bytes (prefer a longer random password), and configure an independent server-only `HOME_ACCESS_SIGNING_SECRET` with at least 32 random UTF-8 bytes. Rotating either value invalidates every `home-access` cookie. Never use committed literal secret fixtures for either value. The credential, signing secret, and cookie are independent from Home customer sessions and any future administrator session; passing the gate never identifies or authorizes a customer, administrator, support agent, or configuration change.

When enabling this gate, configure `HOME_ACCESS_SIGNING_SECRET` before or with the first deployment that requires it. A deployment with `HOME_ACCESS_REQUIRED=1` and a missing or short signing secret fails closed with `503 ACCESS_UNAVAILABLE`.

Keep Vercel Authentication enabled while deploying and verifying the gate. After authorized verification, change **Project Settings → Deployment Protection** to exactly **Only Preview Deployments**. This keeps previews behind Vercel Authentication and removes it only from production so the public Apple association file, signed webhook endpoints, and the action-bound wallet paymaster callback can reach Home. Roll back by restoring Vercel Authentication for production; do not widen the application's public-route allowlist.

Before that setting change, an operator must configure cross-instance Vercel Firewall rate-limit rules for failed access submissions and unauthenticated cost-bearing endpoints, including `POST /api/access`, `POST /api/auth/base/nonce`, `POST /api/auth/base/verify`, `POST /api/actions/*/paymaster` (the unauthenticated wallet callback that forwards to a credential-bearing upstream), and `/api/market-prices/history`. Home intentionally has no in-memory or database rate limiter for this deployment boundary. Firewall configuration, protected-deployment checks, and WAF inspection are privileged operator actions, not CI proof.

After the setting change, the operator runs unauthenticated live probes for the exact Apple file, protected pages and APIs, and rejected CDP, funding, and card webhook deliveries, then separately verifies deployment access, Home sign-in, Home sign-out, and access logout. These live probes must record the deployment and commit without recording the shared credential. Local tests and preview evidence do not establish that production, Deployment Protection, Firewall, or webhook delivery was verified.

### Administrator access

Set server-only `HOME_OPERATOR_ADDRESSES` to comma-separated `0x` + 40-hex-character Base smart-account addresses and redeploy. Blank, malformed, or duplicate entries deny every administrator; surrounding ASCII whitespace is accepted. Rotation or recovery means editing the list and redeploying: new addresses are admitted, removed addresses are denied, and customer sessions and data remain untouched. The deployment access gate, when enabled, runs first; a valid Home session and separate operator decision follow. `/admin` pages require a server-reverified native session, not a CDP render hint; the admin API also accepts verified CDP bearer authentication. The Settings section at `/admin` includes an Invest pane for discovery visibility; without a database it shows a full-catalog notice, and when the database read is unavailable it shows a retry-later notice. Support chat routes `/api/support/chat` and `/api/support/handoff` and administrator routes `/api/admin/support/assistant/credential` and `/api/admin/support/conversations/[id]/handler` remain behind the shared deployment-access gate; none are public or machine routes. Each request separately checks its customer or operator session, and every mutation enforces same-origin JSON. The assistant key is supplied by an operator, sealed in PostgreSQL with the existing server-only `HOME_SECRET_ENCRYPTION_KEY`/`HOME_SECRET_KEY_VERSION` keyring, and never placed in client or deployment variables. Missing keyring disables the assistant without changing the shared firewall. The operator console at `/admin` starts with the Overview setup checklist and Running version. It also provides Settings, the support inbox, and the Money fee revenue view when the settings store and database are available; Account entry and some operational data views are not yet available.

On an authorized protected deployment, supply deployment access separately, then probe `curl -i https://<host>/api/admin/session`: without Home authentication expect 401, with a non-admin session expect 403, and with an administrator session expect 200 and the address. Check `Cache-Control` includes `private` and `no-store` for each; do not record access cookies, bearer tokens, or personal data. These are manual protected-deployment checks, not proof from local CI.

Brand settings use the `brand` domain in `operator_settings`; administrator GET/PUT `/api/admin/settings/brand` requires `DATABASE_URL` and returns 503 without it, never an in-memory value. The production build applies the existing migration. Previews pointed at the production database see the same brand row, and preview writes change production; Neon preview branches have separate data. After an upstream update, use an authenticated administrator session to GET `/api/admin/settings/brand` and confirm a saved override still returns `source: "stored"` with the revision recorded before the update. Record only HTTP status, source, and revision; never record cookies, addresses, or tokens. Brand values are not yet applied to customer pages.

### Skew Protection

For your Home Vercel project, enable **Project Settings → Advanced → Skew Protection** with a 12-hour max age.

Next exposes the serving deployment ID to client code, and Home adds it as the `x-deployment-id` header on client requests to `/api/*`. No environment variable is required. We use the explicit header rather than the alternative experimental `experimental.useSkewCookie` option.

Public reads use the shared public-resource helper: a pinned 404 without a JSON body means the deployment expired and reloads the page once per expired deployment ID. All other failures surface as failed reads, never empty results.

Verify against a preview after an older deployment passes the configured max age:

```sh
# Set <old dpl id>, <current dpl id>, and <preview> from the Vercel preview deployments.
curl -sI -H "x-deployment-id: <old dpl id>" https://<preview>/api/market-prices    # 404 (expected; verify once on a preview)
curl -sI -H "x-deployment-id: <current dpl id>" https://<preview>/api/market-prices # 200
```

## Storybook workshop: separate project

Storybook must use a separate Vercel project (for example, `<project>-storybook`); it is not another output of your Home application project. Configure the Storybook project as follows:

| Setting | Value |
| --- | --- |
| Owner and source | Same Vercel team as the Home project; this repository or your fork |
| Root Directory | `apps/web` |
| Framework preset | Other |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build-storybook` |
| Output Directory | `storybook-static` |
| Production Branch | `main` |
| Git integration | Current-main production deployment and a distinct, immutable preview deployment for each PR head |
| Deployment protection | Vercel Authentication on production and previews, unless the operator chooses a stricter existing convention |
| Environment variables | None; do not copy Home, provider, wallet, or database variables |

Do not add `apps/web/vercel.json`: both projects share that root, so a repository-level override could change the production Home application. Per-project Vercel settings are the isolation boundary. Project creation, team ownership, Git integration, and deployment protection are privileged operator actions; these documented settings do not claim that a hosted Storybook project or URL exists.

When this project is created before Storybook reaches `main`, the initial production deployment from `main` is expected to fail because that branch does not yet contain the Storybook build script. Keep **Production Branch** set to `main`; create or trigger the PR-head preview instead of temporarily treating the feature branch as production. After merge, verify that the first `main` deployment succeeds before calling current-main hosting complete.

A review reference records the project owner, relevant settings, commit SHA, deployment-specific URL, and direct [manager and canvas story links](design-system/component-workshop.md). Do not use a moving branch or project alias as the approval reference. Protected hosted access follows the provisioned paths in the [browser-validation contract](browser-validation.md); credential-free local start and static build remain the separate reproduction path.

After the operator provisions the project, verify without weakening protection:

- From `main`, confirm the deployment identifies the current `main` commit and opens a manager link and its canvas link at the deployment-specific URL.
- From a PR, confirm Git integration creates a different preview tied to the current PR-head commit; select stories, change mobile/desktop viewports, and exercise the dialog from both manager and canvas links.
- Push a new PR head and confirm it creates a new deployment-specific URL. Refresh current-head evidence rather than reusing the older preview.
- Confirm Vercel Authentication protects both production and preview access and that an authorized operator can open them.
- Confirm the project has no Home/provider/database environment variables, and record exact limitations or failed checks rather than claiming hosted acceptance.

## Environment

Copy names from [`.env.example`](../.env.example); keep values in Vercel or gitignored `apps/web/.env.local`. Never expose server keys with `NEXT_PUBLIC_`. The legacy `FUNDING_SANDBOX` flag is rejected. Keep `COINBASE_ONRAMP_MODE`, `PEER_OFFRAMP_MODE`, and the currently unused generic sandbox override `FUNDING_SANDBOX_CLIENT_IP` unset on production Vercel; Coinbase Embedded Orders does not consume that override.

Actions and balance observations require server-only `DATABASE_URL`; Home connects to PostgreSQL via `pg`, so Neon works as a regular Postgres database; keep `?sslmode=require` (or `verify-full`) in the URL and use Neon's pooled hostname on Vercel. The production build runs `bun run db:migrate` automatically before Next.js builds, so there is nothing to run by hand. With [Neon preview branches](#neon-preview-branches) enabled, each preview Git branch (one per PR) gets one `preview/<git-branch>` database branch copied from its parent. Every preview deployment of that Git branch reuses the same database branch, so data written by an earlier revision persists into later ones until the branch is deleted; treat preview data as production data. Non-production Vercel builds still skip migrations unless `HOME_MIGRATE_ON_BUILD=1` is set, even with a preview branch, so a PR adding a migration runs against the parent's schema until merge. Without preview branches, previews share the production database; keep the migration skip and **never** set `HOME_MIGRATE_ON_BUILD=1` for previews in that setup. Configure server-only `BASE_RPC_URL` and `ETHEREUM_RPC_URL` for hosted Base and mainnet ENS reads. Email sign-in requires the CDP project ID plus server validation keys. See [CDP setup](cdp-setup.md) for allowed origins.
The optional server-only HTTPS `CDP_PAYMASTER_URL` enables customer-paid USDC network fees through the CDP paymaster; leave it unset for the existing ETH-gas flow. Treat the URL as a credential and never expose it with `NEXT_PUBLIC_`.

## Neon preview branches

Vercel-Managed and Neon-Managed integrations create preview database branches named `preview/<git-branch>` ([Neon branch cleanup](https://neon.com/docs/guides/vercel-branch-cleanup)). Two workflows manage cleanup, not branch creation; both no-op (exit 0) without repository secret `NEON_API_KEY` and `NEON_PROJECT_ID` configured as a repository variable or secret, so forks without Neon stay green:

- `.github/workflows/neon-preview-cleanup.yml` deletes `preview/<head_ref>` when a PR closes. This is the primary path. An already-deleted branch counts as deleted, so cleanup stays idempotent when the Neon integration or the prune got there first.
- `.github/workflows/neon-preview-prune.yml` keeps headroom under Neon Free's 10-total-branch cap. The Neon integration is a required preview deployment step, so when the project is full a new branch's preview fails before building with "Resource provisioning failed". The prune runs on every push to a branch other than `main`, with a schedule and manual dispatch as backstops; GitHub runs the schedule hours apart, so it cannot be relied on alone. The planner in [`scripts/ci/neon-preview-prune-plan.mjs`](../scripts/ci/neon-preview-prune-plan.mjs) counts **all** project branches toward the cap, deletes stale eligible `preview/*` branches first (no open PR and at least one closed or merged PR), then deletes the oldest remaining previews until total branches reach cap minus `headroom`. The default `headroom` is 4, so `main + five previews = six total` leaves four slots under the 10-branch cap. It never deletes default, protected, or non-`preview/*` branches, nor `preview/main`, `preview/production`, or `preview/prod` (case-insensitive). A malformed or empty branch list stops the prune before deletion.

After stale previews, ordering is oldest-first, so when the project exceeds its total-branch target the prune can delete the preview database of a still-open, older PR even while that PR's Vercel preview stays up. That is accepted policy, not a bug; PR-close cleanup remains the primary path. Manual runs use the workflow's `headroom` (free slots to leave under the cap) and `dry_run` (list deletions without calling DELETE) inputs. If non-eligible branches prevent the target, the workflow warns when a slot remains; if the project remains at the cap after planned deletions, it reports an error naming non-eligible branches because the next preview deployment will fail.

## CDP balance activity webhook

Configure `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` in production. On the first authenticated balance read for an address, Home automatically finds an enabled `wallet_activity` subscription for Base mainnet and this deployment, adds the address when there is room, or creates a new subscription and stores its one-time signing secret as an authenticated envelope in PostgreSQL ([key provisioning and rotation](secrets-at-rest.md)). Configure the shared `HOME_SECRET_*` keyring on every writer before allowing new subscriptions; missing keys prevent creation, while unreadable rows reject deliveries and leave balance polling as the backstop. Production targets `https://${VERCEL_PROJECT_PRODUCTION_URL}/api/webhooks/cdp`; `HOME_WEBHOOK_ORIGIN` optionally overrides the public HTTPS origin for another managed environment. Registration is disabled without `DATABASE_URL` because an ephemeral instance cannot retain the signing secret.

Confirm registration through the `balances-webhook-subscription` server events and by listing webhook subscriptions with the CDP CLI/API. Then send a real test delivery, confirm `/api/webhooks/cdp` returns 200, and confirm the next authenticated balance read fully re-observes. A missed delivery remains bounded by the 120-second balance backstop.

Funding origin and client-IP derivation trust Vercel to own `x-forwarded-host`, `x-forwarded-proto`, and `x-forwarded-for`. The default presentation country uses Vercel's `x-vercel-ip-country` ([country resolution](regional-money.md#country-resolution)); off Vercel it is absent and the presentation default is `US`. Stock-buy eligibility separately trusts that edge header only when `VERCEL=1` or `HOME_TRUST_EDGE_COUNTRY_HEADER=true`; a self-hosted fork must have an edge that overwrites the header before setting that flag, and an absent or invalid country blocks stock buys. Stock sells to Base USDC remain allowed. Do not expose a bare `next start` server directly to untrusted clients without a proxy that overwrites those headers.

The action contract is [Actions](actions.md) under [Architecture](architecture.md): Home records confirmed actions, while CDP/Base and Base receipts provide execution status. A green deployment does not authorize a real-money launch.
