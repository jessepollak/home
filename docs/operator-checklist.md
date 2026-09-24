# Operator checklist

Each operator sets these values for their own instance; this checklist lists what to set and where, never the values themselves.

## Hosting project

| Value | Where you set it | Docs |
| --- | --- | --- |
| Home project name and team/scope | Vercel project and team | [Vercel deploy](vercel-deploy.md) |
| Production origin and branch origin pattern `https://<project>-git-<sanitized-branch>-<scope>.vercel.app` | Vercel project domains and Git branch URLs | [Vercel deploy](vercel-deploy.md), [CDP setup](cdp-setup.md#branch-stable-origin) |
| Root `apps/web`, Next.js, frozen Bun install, build, Node.js version | Vercel project build settings | [Vercel deploy](vercel-deploy.md#home-application) |
| Deployment Protection and Firewall rate-limit rules | Vercel project settings and Firewall | [Vercel deploy](vercel-deploy.md#pre-release-production-access) |
| Skew Protection (12-hour max age) | Vercel project advanced settings | [Vercel deploy](vercel-deploy.md#skew-protection) |
| Speed Insights | Vercel project settings | [Performance observability](performance-observability.md#production-verification) |

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

## Environment variables

The root [`.env.example`](../.env.example) is the complete list of names and their comments; this table indexes the variables that gate core capabilities. A capability stays disabled or inert until its variables are set.

| Value | Where you set it | Docs |
| --- | --- | --- |
| `HOME_ACCESS_REQUIRED`, `HOME_ACCESS_PASSWORD`, `HOME_ACCESS_SIGNING_SECRET` | Vercel environment | [Vercel deploy](vercel-deploy.md#pre-release-production-access) |
| `HOME_OPERATOR_ADDRESSES` | Vercel environment | [Vercel deploy](vercel-deploy.md#administrator-access) |
| `HOME_SESSION_SECRET` (at least 32 characters; required for Base Account sign-in) | Vercel environment; local `.env.local` | [Base Account](base-account.md) |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (required for email sign-in validation, balance enumeration, and the balance webhook) | Vercel environment; local `.env.local` | [CDP setup](cdp-setup.md), [Vercel deploy](vercel-deploy.md#cdp-balance-activity-webhook) |
| `CDP_SQL_CLIENT_API_KEY` (required for the default Activity history source) | Vercel environment; local `.env.local` | [`.env.example`](../.env.example) |
| `CODEX_API_KEY` (server-only; required for token prices, balance valuations, Invest discovery, and historical Activity valuations) | Vercel environment; local `.env.local` | [Codex prices](codex-prices.md#server-setup), [Activity valuation](activity-valuation.md) |
| `FUNDING_QUOTE_SECRET` (at least 32 characters; required for any funding binding) | Vercel environment; local `.env.local` | [`.env.example`](../.env.example) |
| Provider credentials, for example `IDRX_*`, `RIPIO_*_<country>`, `PEER_OFFRAMP_ENABLED` (each binding stays inert until its manifest variables are set) | Vercel environment | [Provider registrations](#provider-registrations) |
| `DATABASE_URL` | Vercel environment; local `.env.local` | [Vercel deploy](vercel-deploy.md#environment) |
| `HOME_WEBHOOK_ORIGIN` (optional origin override) | Vercel environment | [Vercel deploy](vercel-deploy.md#cdp-balance-activity-webhook) |
| `BASE_RPC_URL`, `ETHEREUM_RPC_URL` | Vercel environment; local `.env.local` | [Vercel deploy](vercel-deploy.md#environment) |
| `HOME_VERIFY_PRODUCTION_URL` (local-only live verification) | Private local runner environment | [Browser validation](browser-validation.md#live-session) |
