# home

An open-source home for your money on Base.

Home is a mobile-first financial app designed around local currencies: sign in by email, hold and move money, add funds through local payment methods, save, and invest.

**Status: local finance spike, not production-approved.** The app includes local-currency wallet/savings valuation, USDC/ETH send and receive, durable operation recovery, indexed activity, Morpho USDC deposit/withdrawal, email-controlled crypto trade preparation/execution, a bounded cbBTC/USDC borrowing market, and a Coinbase funding handoff. The landing, animated Home mark, and shared finance components are integrated.

Real wallet signatures and funded end-to-end flows have not been exercised. Stock trading and external Base-account trading remain gated; Borrow requires a compatible deployed account, and hosted funding requires Coinbase access/origin configuration. See [build status](docs/build-status.md) for validation evidence and remaining limits.

## Get started

This repository is meant to be **cloned and run**, then customized. Brand, regions, asset selection, and providers are replaceable; each operator uses their own projects and credentials. See [Fork and extend](docs/fork-and-extend.md) when you are ready to change those. Current-state docs: [build status](docs/build-status.md), [wallet runtime](docs/wallet-runtime-spike.md), [architecture review](docs/architecture-review-2026-09.md). The [docs index](docs/README.md) lists setup, product-intent, and **target/archive** notes (the 2026-09-07 design is not the live tree).

### Prerequisites

- **Bun 1.3.12** — pinned as `packageManager` in `package.json`.
- **Node.js 22 or newer** — `engines.node` is `>=22`. Local money-action persistence uses `node:sqlite`, which needs Node **22.13+**. The spike was validated on **Node 24**.

### Run locally

```sh
bun install --frozen-lockfile
bun dev
```

Open http://localhost:3000. The server binds to loopback; development document navigation from `127.0.0.1` redirects to the canonical `localhost` origin.

### Environment

For a fresh clone, copy the root example into the web app (gitignored). **Do not overwrite** an existing `apps/web/.env.local`.

```sh
cp .env.example apps/web/.env.local
```

If that file already exists, add only missing variables.

| Without CDP credentials | Needs your CDP project |
|---|---|
| Landing, browsing, public Morpho vault reads, informational Invest | Email sign-in, server session validation, authenticated balances and money actions |

Email sign-in needs the public CDP project ID (`NEXT_PUBLIC_CDP_PROJECT_ID`) and matching server keys (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`) from **your** project. Configure the exact origin `http://localhost:3000` in that CDP project. Optional: `CODEX_API_KEY` for Invest USD snapshots; `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT` for the Base Account path. Never commit secrets or prefix server keys with `NEXT_PUBLIC_`. Details: [CDP setup](docs/cdp-setup.md).

### Scripts

```sh
bun test        # Deterministic unit and contract tests; live probes stay opt-in
bun lint        # ESLint
bun typecheck   # Next route types and strict TypeScript
bun build       # Production build
bun check       # Tests, lint, typecheck and production build
bun run --cwd apps/web test:browser-auth # Actual-component auth scenarios with mocked boundaries
bun start       # Serve a production build
bun run money-actions:migrate  # Apply Neon schema from local/CI (needs DATABASE_URL; not the Vercel build)
```

GitHub Actions CI on pull requests and pushes to `main` runs `bun install --frozen-lockfile` then `bun check`. Live probes stay opt-in and are not enabled in CI.

### Local persistence

Money-action records use a private, automatically created SQLite database under `.local/` (typically `apps/web/.local/home-money-actions.sqlite` when Next runs from the web workspace) when `DATABASE_URL` is unset. No hosted database is needed for local `bun dev`. On Vercel, landing and browse can deploy without `DATABASE_URL`; money-action routes fail closed without it. Set server-only `DATABASE_URL` (Neon) for hosted persistence, then apply the schema from local or CI with `bun run money-actions:migrate` — not as part of the default Vercel build. The hosted path does not load `node:sqlite`. Read [wallet runtime notes](docs/wallet-runtime-spike.md), [Vercel deploy](docs/vercel-deploy.md), and [build status](docs/build-status.md) before any deployment. This is not production authorization.

Edit `apps/web/app/home-experience.tsx` for the Home shell, `apps/web/features/` for account/Invest/Savings UI, `apps/web/app/globals.css` for visual tokens, and `apps/web/config/` for presentation settings and sourced asset identities. Keep one root `bun.lock`. Real configuration belongs only in the gitignored `apps/web/.env.local`.

## Start here

Current tree first. Target and archive docs are last so they cannot be mistaken for the live app.

1. [Get started](#get-started) — clone, install, env, `bun dev`.
2. [Build status](docs/build-status.md) — what is delivered and which gates remain.
3. [Wallet runtime](docs/wallet-runtime-spike.md) — prepare → claim → submit → receipt; SQLite locally, Neon when `DATABASE_URL` is set.
4. [Architecture review](docs/architecture-review-2026-09.md) — current-tree patterns, risks, contribution contract.
5. [Docs index](docs/README.md) — full map (operate / product intent / target / archive).
6. [Fork and extend](docs/fork-and-extend.md) — brand, regions, assets, providers.
7. [CDP setup](docs/cdp-setup.md) · [SQL setup](docs/cdp-sql.md) · [Morpho setup](docs/morpho-setup.md) · [Invest data](docs/invest-data.md)
8. [Vercel deploy](docs/vercel-deploy.md) — bun monorepo build settings; hosted money actions need Neon `DATABASE_URL`.

Product intent (not delivery state): [product scope](docs/product-scope.md), [regional money](docs/regional-money.md), [currency defaults](docs/currency-defaults.md), [stablecoin candidates](docs/stablecoin-candidates.json).

Target / archive (not the current tree): [target architecture](docs/target-architecture.md) (formerly technical design), [archived implementation plan](docs/archive/implementation-plan-2026-09-07.md).

Sending a focused PR / joining as eng #2 is optional: see [CONTRIBUTING](CONTRIBUTING.md).

## Stack and boundaries

Next.js, TypeScript, Tailwind and local SQLite; CDP email authentication/user-controlled smart accounts, CDP SQL history and trade quotes, Base RPC balances/receipts, and Morpho. Production shared persistence, webhook operations, and deployment remain separate work. No new hosted provider was provisioned for this spike.

Country selection controls presentation, not eligibility. Wallet and savings value covers the configured inventory; Borrow collateral and debt are shown separately. Exact asset/network details and user approval remain part of financial review.

Venice/agent inference, Rain cards, additional funding providers, unrestricted assets, and broader borrowing markets are not implemented.

## Forking

Fork this repository to run your own Home. Brand, regions, asset selection and providers are designed to be replaceable — [fork and extend](docs/fork-and-extend.md) is the how-to. Each operator configures their own provider projects, credentials and deployment.

Sending a focused PR is optional. If you do, run `bun check` first. For UI / core-flow PRs, prefer a Before/After table of **inline embeds** in the GitHub description when both shots exist; after-only is OK when a before shot isn’t useful ([UI PR previews](docs/ui-pr-previews.md)). Never commit credentials or funded-wallet secrets. Documented token/provider support is separate from a tested integration.

## License

Original repository content is licensed under [MIT](LICENSE). Linked third-party materials, provider SDKs and trademarks retain their respective terms.
