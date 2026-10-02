# Operator checklist

Each operator sets these values for their own instance; this checklist lists what to set and where, never the values themselves.

## Products and markets

At Admin → Settings → Products and markets, a saved settings row wins over deployment values. Without a saved row the pane shows deployment values; reading the pane does not write anything. Review and save to change offerings. Settings only narrow code and credential availability: turning off new entries leaves existing positions and exits available. A first save identical to deployment values leaves the row absent.

## Hosting project

| Value | Where you set it | Docs |
| --- | --- | --- |
| Home project name and team/scope | Vercel project and team | [Vercel deploy](vercel-deploy.md) |
| Production origin and branch origin pattern `https://<project>-git-<sanitized-branch>-<scope>.vercel.app` | Vercel project domains and Git branch URLs | [Vercel deploy](vercel-deploy.md), [CDP setup](cdp-setup.md#branch-stable-origin) |
| Root `apps/web`, Next.js, frozen Bun install, build, Node.js version | Vercel project build settings | [Vercel deploy](vercel-deploy.md#home-application) |
| Deployment Protection and Firewall rate-limit rules | Vercel project settings and Firewall | [Vercel deploy](vercel-deploy.md#pre-release-production-access) |
| Skew Protection (12-hour max age) | Vercel project advanced settings | [Vercel deploy](vercel-deploy.md#skew-protection) |
| Speed Insights | Vercel project settings | [Performance observability](performance-observability.md#production-verification) |
| Fluid compute (enabled) | Vercel project Functions settings | [Vercel deploy](vercel-deploy.md#database-pool-lifecycle) |

## Storybook project

| Value | Where you set it | Docs |
| --- | --- | --- |
| Separate Storybook project name (for example, `<project>-storybook`) and same Vercel team as Home | Vercel project and team | [Vercel deploy](vercel-deploy.md#storybook-workshop-separate-project) |
| Source repository: this repository or your fork | Storybook project's Vercel Git integration | [Vercel deploy](vercel-deploy.md#storybook-workshop-separate-project) |

## Database

| Value | Where you set it | Docs |
| --- | --- | --- |
| Postgres/Neon project and production connection | Database provider and Vercel `DATABASE_URL` | [Vercel deploy](vercel-deploy.md#environment) |
| `preview/<git-branch>` database branches (if enabled) | Vercel/Neon preview-branch integration | [Vercel deploy](vercel-deploy.md#neon-preview-branches) |
| `NEON_API_KEY` secret and `NEON_PROJECT_ID` variable for preview-branch workflows | GitHub repository Actions secrets and variables | [Vercel deploy](vercel-deploy.md#neon-preview-branches) |

## CDP

| Value | Where you set it | Docs |
| --- | --- | --- |
| `NEXT_PUBLIC_CDP_PROJECT_ID` | Vercel environment and local `.env.local` | [CDP setup](cdp-setup.md#local-setup) |
| Embedded Wallet exact allowed origins: production origin, `http://localhost:3000`, and optional branch origins (maximum 50) | CDP Portal Embedded Wallet CORS | [CDP setup](cdp-setup.md#preview-auth) |
| Onramp domain list (separate from Embedded Wallet CORS) | CDP Portal Onramp | [CDP setup](cdp-setup.md#embedded-wallet-cors-vs-onramp) |

## Provider registrations

| Value | Where you set it | Docs |
| --- | --- | --- |
| Apple Pay merchant domain verification file and production/preview domain enablement | CDP Portal / Coinbase Onramp and hosted domain | [Coinbase provider](../apps/web/server/funding/providers/coinbase/README.md#iframe-and-domain-requirements) |
| Ripio per-country callback URLs and secrets | Each Ripio country dashboard and Vercel environment | [Ripio provider](../apps/web/server/funding/providers/ripio/README.md#confirm-against-your-api) |
| Peer or other provider enablement | Provider dashboard and Vercel environment | [Peer provider](../apps/web/server/funding/providers/peer/README.md#implementation-and-enablement-gates), [Coinbase provider](../apps/web/server/funding/providers/coinbase/README.md#operator-actions) |

## Money in and out

**Admin → Settings → Money in and out** (`/admin/settings/funding`) chooses which funding corridors are offered, per provider, region, and direction. Credentials stay in the environment and only make a corridor *connected*; the page shows each credential as set or unset, never its value. A corridor is offered only when it is connected and switched on.

- **Until the first save**, Home uses deployment values: every connected corridor is offered, and Peer follows `PEER_OFFRAMP_ENABLED=1`. Nothing is written until you save.
- **After the first save**, the saved settings win. `PEER_OFFRAMP_ENABLED` is ignored, and a corridor added by a later upstream update starts off.
- **Pausing** stops new entries within seconds: listing for new customers, quotes, order creation, starting provider verification, and new cash-outs. A cash-out prepared before the pause is refused when the customer confirms it. A paused corridor stays visible to a customer who already has an open or ambiguous order there, so that order can still be finished and followed. Status refresh, webhooks, ambiguous-order resolution, withdrawal, and recovery never read the setting, so open orders keep reconciling.
- **Turning a corridor on** takes a review of its credential status, the evidence note of every provider binding that switch covers (all of them when a provider offers several, or `none recorded`), and what customers will see, then a confirmation.
- **If the settings can't be read**, new money in and out fails closed; exits keep working.
- Every save that changes settings is recorded in the admin audit log with its before and after values, readable by an administrator at `GET /api/admin/audit`. A save based on a stale revision is rejected.

### Roll back

1. **Undo a setting:** find the `settings.update` entry for `funding` in the audit log and set the corridors in Money in and out back to its `before` value. The first save's `before` is empty rather than the deployment values; there, use its `after` value, which was pre-filled from the deployment values, and reverse only the corridors you changed. Saving can't return the domain to deployment values.
2. **Before rolling the app back to a release without this page**, make the environment match the console. Older releases decide from the environment alone, so a corridor paused only in the console reopens. For Peer, unset `PEER_OFFRAMP_ENABLED`. For a credential-backed provider, the old release can pause a corridor only by removing its credentials, and that also stops status refresh and webhooks for its open orders. Remove credentials only after that provider's open orders have settled; otherwise keep them set, accept that the corridor reopens, or don't roll back. A corridor that is on only in the console stays off after the rollback until its environment is set. The providers and open-order reads interoperate across this release boundary in both directions: an older server still answers them with the contract versions this release's client accepts, and an older client ignores the added response field.
3. Rolling forward again restores the saved settings unchanged.

## Environment variables

The root [`.env.example`](../.env.example) is the complete list of names and their comments; this table indexes the variables that gate core capabilities. A capability stays disabled or inert until its variables are set.

| Value | Where you set it | Docs |
| --- | --- | --- |
| `HOME_ACCESS_REQUIRED`, `HOME_ACCESS_PASSWORD`, `HOME_ACCESS_SIGNING_SECRET` | Vercel environment | [Vercel deploy](vercel-deploy.md#pre-release-production-access) |
| `HOME_OPERATOR_ADDRESSES` | Vercel environment | [Vercel deploy](vercel-deploy.md#administrator-access) |
| `HOME_SESSION_SECRET` (at least 32 characters; required for Base Account sign-in) | Vercel environment; local `.env.local` | [Base Account](base-account.md) |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (required for email sign-in validation, balance enumeration, the balance webhook, and CDP SQL Activity history; no separate SQL key is needed) | Vercel environment; local `.env.local` | [CDP setup](cdp-setup.md), [Vercel deploy](vercel-deploy.md#cdp-balance-activity-webhook), [CDP SQL](cdp-sql.md#authentication-decision) |
| `CDP_SQL_AUTH_MODE`, `CDP_SQL_CLIENT_API_KEY` (optional; only to use a dedicated SQL client key instead of the CDP server key) | Vercel environment; local `.env.local` | [CDP SQL](cdp-sql.md#authentication-decision) |
| `CODEX_API_KEY` (server-only; required for token prices, balance valuations, Invest discovery, and historical Activity valuations) | Vercel environment; local `.env.local` | [Codex prices](codex-prices.md#server-setup), [Activity valuation](activity-valuation.md) |
| `FUNDING_QUOTE_SECRET` (at least 32 characters; required for any funding binding) | Vercel environment; local `.env.local` | [`.env.example`](../.env.example) |
| Provider credentials, for example `IDRX_*`, `RIPIO_*_<country>` (a binding is *connected* once its manifest variables are set; whether it is *offered* is chosen in [Money in and out](#money-in-and-out)) | Vercel environment | [Provider registrations](#provider-registrations) |
| `PEER_OFFRAMP_ENABLED` (legacy; read only until Money in and out is first saved, then shown as "set but ignored") | Vercel environment | [Money in and out](#money-in-and-out) |
| `DATABASE_URL` | Vercel environment; local `.env.local` | [Vercel deploy](vercel-deploy.md#environment) |
| `HOME_WEBHOOK_ORIGIN` (optional origin override) | Vercel environment | [Vercel deploy](vercel-deploy.md#cdp-balance-activity-webhook) |
| `BASE_RPC_URL`, `ETHEREUM_RPC_URL` | Vercel environment; local `.env.local` | [Vercel deploy](vercel-deploy.md#environment) |
| `HOME_VERIFY_PRODUCTION_URL` (local-only live verification) | Private local runner environment | [Browser validation](browser-validation.md#live-session) |

## Admin settings

Administrators change these in the operator console after [administrator access](vercel-deploy.md#administrator-access) is set. Each save is revision-checked, recorded in the audit log, and carries the address of the operator who opened the page; a save is refused with `409 OPERATOR_CHANGED` when the signed-in operator no longer matches it, and the page re-syncs and asks for a reload. Fee changes apply to new quotes only. A new or changed revenue destination is saved only after the administrator confirms its full checksummed address.

| Value | Where you set it | Docs |
| --- | --- | --- |
| Swap fee, 0–300 basis points (default 0, off) | `/admin/settings` → Fees | [Administrator access](vercel-deploy.md#administrator-access) |
| Revenue destination: a Base address that only receives fees, such as a multisig or another account held outside Home (required when the fee is above 0) | `/admin/settings` → Fees | [Administrator access](vercel-deploy.md#administrator-access) |
