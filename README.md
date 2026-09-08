# home

An open-source home for your money on Base.

Home is a mobile-first financial app designed around local currencies: sign in by email, hold and move money, add funds through local payment methods, save, and invest.

**Status: local finance spike, not production-approved.** The app includes local-currency wallet/savings valuation, USDC/ETH send and receive, durable operation recovery, indexed activity, Morpho USDC deposit/withdrawal, email-controlled crypto trade preparation/execution, a bounded cbBTC/USDC borrowing market, and a Coinbase funding handoff. The landing, animated Home mark, and shared finance components are integrated.

Real wallet signatures and funded end-to-end flows have not been exercised. Stock trading and external Base-account trading remain gated; Borrow requires a compatible deployed account, and hosted funding requires Coinbase access/origin configuration. See [build status](docs/build-status.md) for validation evidence and remaining limits.

## Get started

This repository is meant to be **cloned and run**, then customized. Brand, regions, asset selection, and providers are replaceable; each operator uses their own projects and credentials. See [Fork and extend](docs/fork-and-extend.md) when you are ready to change those. The [docs index](docs/README.md) lists setup, design, and registry notes.

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
```

GitHub Actions CI on pull requests and pushes to `main` runs `bun install --frozen-lockfile` then `bun check`. Live probes stay opt-in and are not enabled in CI.

### Local persistence

Money-action records use a private, automatically created SQLite database under `.local/` (typically `apps/web/.local/home-money-actions.sqlite` when Next runs from the web workspace). No hosted database is needed for the local spike. **This is not shared production persistence.** Read [wallet runtime notes](docs/wallet-runtime-spike.md) and [build status](docs/build-status.md) before any deployment. The production store described in [technical design](docs/technical-design.md) is Neon/Postgres; it is not what `bun dev` uses.

Edit `apps/web/app/home-experience.tsx` for the Home shell, `apps/web/features/` for account/Invest/Savings UI, `apps/web/app/globals.css` for visual tokens, and `apps/web/config/` for presentation settings and sourced asset identities. Keep one root `bun.lock`. Real configuration belongs only in the gitignored `apps/web/.env.local`.

## Start here

- [Get started](#get-started) — clone, install, env, `bun dev`.
- [Fork and extend](docs/fork-and-extend.md) — brand, regions, assets, providers, local-spike vs production.
- [Docs index](docs/README.md) — run/operate, design, and registry docs.
- [CDP setup](docs/cdp-setup.md) — project/origins, email login, server validation and privacy defaults.
- [SQL setup](docs/cdp-sql.md) — explicit authentication mode, bounded smoke tests and history limitations.
- [Morpho setup](docs/morpho-setup.md) — USDC vault candidates and read-only verification.
- [Invest data](docs/invest-data.md) — stock/meme identities and price/eligibility boundaries.
- [Technical design](docs/technical-design.md) — architecture, provider boundaries, persistence, signing and status recovery.
- [Implementation plan](docs/implementation-plan.md) — buildable chunks, dependencies and acceptance checks.
- [Product scope](docs/product-scope.md) — user experience and roadmap.
- [Regional money](docs/regional-money.md) — geo defaults and native-currency presentation.
- [Currency defaults](docs/currency-defaults.md) — confirmed selections, including **CADD for Canada** and **wARS for Argentina**.
- [Stablecoin candidates](docs/stablecoin-candidates.json) — sourced Base contract metadata; verification remains pending and every asset is disabled.

## Stack and boundaries

Next.js, TypeScript, Tailwind and local SQLite; CDP email authentication/user-controlled smart accounts, CDP SQL history and trade quotes, Base RPC balances/receipts, and Morpho. Production shared persistence, webhook operations, and deployment remain separate work. No new hosted provider was provisioned for this spike.

Country selection controls presentation, not eligibility. Wallet and savings value covers the configured inventory; Borrow collateral and debt are shown separately. Exact asset/network details and user approval remain part of financial review.

Venice/agent inference, Rain cards, additional funding providers, unrestricted assets, and broader borrowing markets are not implemented.

## Forking

Fork this repository to run your own Home or follow along. Brand, regions, asset selection and providers are designed to be replaceable — [fork and extend](docs/fork-and-extend.md) is the how-to. Each operator configures their own provider projects, credentials and deployment.

Focused pull requests are welcome. If you send one, run `bun check` first. Never commit credentials or funded-wallet secrets. Documented token/provider support is separate from a tested integration.

## License

Original repository content is licensed under [MIT](LICENSE). Linked third-party materials, provider SDKs and trademarks retain their respective terms.
