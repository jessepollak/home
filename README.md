# home

An open-source home for your money on Base.

Home is a mobile-first financial interface for seeing, moving, saving, and exploring money in a familiar local-currency presentation. It brings a wallet, savings, investing, activity, and a focused borrowing flow into one calm Home shell—while keeping the financial action itself explicit at review time.

> **Status:** Home is an integrated local finance spike, not a production-approved money app. The interfaces and local code are available to run, but live wallet signatures, funded end-to-end flows, provider acceptance, and deployment have not been performed. See [build status](docs/build-status.md) for the current implementation and validation limits.

## UI mockups

[![Home, Save, and Invest UI mockups](docs/readme/overview.svg)](docs/readme/overview.svg)

*Home, Save, and Invest UI mockups based on current components. Balances, prices, and rates are illustrative—not live screenshots, funded proof, or production-availability claims.*

[![Send, Activity, and Borrow UI mockups](docs/readme/flows.svg)](docs/readme/flows.svg)

*Send, Activity, and Borrow UI mockups based on current components. Balances, prices, and rates are illustrative—not live screenshots, funded proof, or production-availability claims.*

## What is here

- **Home:** local-currency valuation for the configured wallet and savings inventory, plus funding, USDC/ETH send and receive, and indexed activity.
- **Save:** public Morpho vault information and authenticated USDC deposit/withdrawal flows.
- **Invest:** crypto discovery and email-controlled trade preparation/execution. The Stocks interface is informational; stock trading is not enabled.
- **Borrow:** one bounded cbBTC/USDC Morpho market with collateral, borrow, repay, and withdrawal flows. It requires a compatible deployed account; counterfactual simulation and live funded execution have not been accepted.

Country selection changes presentation and formatting; it is not an eligibility, residency, or funding decision. Ripio-backed local-currency assets are in progress and not implemented. Documented assets and provider seams are not proof of a live integration.

## Get started

Clone the repository and install the pinned dependencies:

```sh
git clone https://github.com/jessepollak/home.git
cd home
bun install --frozen-lockfile
```

### Prerequisites

- **Bun 1.3.12**, pinned by `packageManager`.
- **Node.js 22.13+** for local SQLite persistence (`node:sqlite`); Node 24 was used for local validation.

### Environment

Create the gitignored local environment file only when it does not already exist:

```sh
if [ ! -e apps/web/.env.local ]; then
  cp .env.example apps/web/.env.local
fi
```

Never commit secrets. Server keys stay server-only—do not give them a `NEXT_PUBLIC_` prefix.

| You can browse without CDP credentials | You need your own CDP project and configured origin |
| --- | --- |
| Landing, public Morpho vault reads, and informational Invest | Email sign-in, session validation, authenticated balances, and money actions |

For CDP-backed flows, set `NEXT_PUBLIC_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, and `CDP_API_KEY_SECRET` from your project, then allow the exact local origin `http://localhost:3000`. See [CDP setup](docs/cdp-setup.md) for the complete configuration, including preview origins.

### Run locally

```sh
bun dev
```

Open `http://localhost:3000`. Development navigation from `127.0.0.1` redirects to the canonical `localhost` origin.

Local `bun dev` uses a private SQLite money-action store under `.local/` when `DATABASE_URL` is unset. Hosted persistence uses server-only `DATABASE_URL` with Neon/Postgres instead; no hosted database is required to browse locally. Read [wallet runtime](docs/wallet-runtime-spike.md) and [Vercel deploy](docs/vercel-deploy.md) before deploying money actions.

### Useful commands

```sh
bun test       # deterministic unit and contract tests
bun lint       # ESLint
bun typecheck  # Next route types and strict TypeScript
bun build      # production build
bun check      # test, lint, typecheck, and build
```

## Repository map

| Place | Purpose |
| --- | --- |
| `apps/web/app/` | Next.js routes, shell, and global styles |
| `apps/web/features/` | Home, account, activity, funding, savings, invest, and borrowing UI |
| `apps/web/server/` | Server-side provider, money-action, and protocol boundaries |
| `apps/web/config/` | Brand, regions, navigation, asset, and presentation configuration |
| `docs/` | Setup, runtime, product intent, deployment, and extension notes |

**Stack:** Next.js, TypeScript, Tailwind, Bun, local SQLite for local money actions, and optional Neon/Postgres for hosted persistence. Integrations include CDP, Base RPC, and Morpho; their presence in the repository does not imply shared credentials or live production availability.

## Customize, fork, or contribute

Home is intended to be cloned and adapted. Replace the brand, regions, asset selection, and providers with your own configuration and projects; [Fork and extend](docs/fork-and-extend.md) maps the supported seams. For implementation status and limits, begin with [build status](docs/build-status.md). For focused upstream changes, read [CONTRIBUTING](CONTRIBUTING.md) and run `bun check` before opening a pull request.

## Forking

Fork this repository to operate your own version of Home. Each operator supplies their own provider projects, credentials, persistence, and deployment. [Fork and extend](docs/fork-and-extend.md) explains the configuration points; [the docs index](docs/README.md) collects runtime and product notes. Do not treat a region setting as eligibility or a configured asset as a funded, live route.

## License

Original repository content is licensed under [MIT](LICENSE). Third-party materials, provider SDKs, fonts, and trademarks keep their own terms. In particular, the Home mark’s font provenance and reuse constraints are documented in [`apps/web/public/home-mark/PROVENANCE.md`](apps/web/public/home-mark/PROVENANCE.md); do not assume those assets or Base-related marks are covered by MIT.
