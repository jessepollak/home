# home

An open-source home for your money on Base.

Home is a mobile-first financial app designed around local currencies: sign in by email, hold and move money, add funds through local payment methods, save, and invest.

**Status: local finance spike, not production-approved.** The app includes local-currency wallet/savings valuation, USDC/ETH send and receive, durable operation recovery, indexed activity, Morpho USDC deposit/withdrawal, email-controlled crypto trade preparation/execution, a bounded cbBTC/USDC borrowing market, and a Coinbase funding handoff. The landing, animated Home mark, and shared finance components are integrated.

Real wallet signatures and funded end-to-end flows have not been exercised. Stock trading and external Base-account trading remain gated; Borrow requires a compatible deployed account, and hosted funding requires Coinbase access/origin configuration. See [build status](docs/build-status.md) for validation evidence and remaining limits.

## Run locally

Requires Bun 1.3.12 and Node.js with `node:sqlite` support (22.13+; validated on Node 24).

```sh
bun install --frozen-lockfile
bun dev
```

Open http://localhost:3000. The server binds to loopback; development document navigation from `127.0.0.1` redirects to the canonical `localhost` origin. Configure that exact origin in the CDP project. Browsing works without credentials; email sign-in requires the public CDP project ID and matching server verification credentials. Store configuration in gitignored `apps/web/.env.local` using the root `.env.example`; do not overwrite an existing local environment file.

Money-action records use a private, automatically created SQLite database under `.local/`. No hosted database is needed for the local spike. This is not shared production persistence; review the [wallet runtime notes](docs/wallet-runtime-spike.md) before deployment.

```sh
bun test        # Deterministic unit and contract tests; live probes stay opt-in
bun lint        # ESLint
bun typecheck   # Next route types and strict TypeScript
bun build       # Production build
bun check       # Tests, lint, typecheck and production build
bun run --cwd apps/web test:browser-auth # Actual-component auth scenarios with mocked boundaries
bun start       # Serve a production build
```

Edit `apps/web/app/home-experience.tsx` for the Home shell, `apps/web/features/` for account/Invest/Savings UI, `apps/web/app/globals.css` for visual tokens, and `apps/web/config/` for presentation settings and sourced asset identities. Keep one root `bun.lock`. Real configuration belongs only in the gitignored `apps/web/.env.local`; never commit secrets.

## Start here

- [CDP setup](docs/cdp-setup.md) — project/origins, email login, server validation and privacy defaults.
- [SQL setup](docs/cdp-sql.md) — explicit authentication mode, bounded smoke tests and history limitations.
- [Morpho setup](docs/morpho-setup.md) — USDC vault candidates and read-only verification.
- [Invest data](docs/invest-data.md) — stock/meme identities and price/eligibility boundaries.
- [Architecture review](docs/architecture-review-2026-09.md) — current-tree patterns, risks, and the contribution contract for a second engineer. Read this before the target design docs.
- [Technical design](docs/technical-design.md) — **target** architecture (Vercel, Neon, webhooks, later packages). Not a map of the current tree.
- [Implementation plan](docs/implementation-plan.md) — historical build chunks and acceptance checks; [build status](docs/build-status.md) is the scoreboard.
- [Product scope](docs/product-scope.md) — user experience and roadmap.
- [Regional money](docs/regional-money.md) — geo defaults and native-currency presentation.
- [Currency defaults](docs/currency-defaults.md) — confirmed selections, including **CADD for Canada** and **wARS for Argentina**.
- [Stablecoin candidates](docs/stablecoin-candidates.json) — sourced Base contract metadata; verification remains pending and every asset is disabled.

## Stack and boundaries

Next.js, TypeScript, Tailwind and local SQLite; CDP email authentication/user-controlled smart accounts, CDP SQL history and trade quotes, Base RPC balances/receipts, and Morpho. Production shared persistence, webhook operations, and deployment remain separate work. No new hosted provider was provisioned for this spike.

Country selection controls presentation, not eligibility. Wallet and savings value covers the configured inventory; Borrow collateral and debt are shown separately. Exact asset/network details and user approval remain part of financial review.

Venice/agent inference, Rain cards, additional funding providers, unrestricted assets, and broader borrowing markets are not implemented.

## Forking and contributing

Fork this repository to follow along or build your own version. Brand, regions, asset selection and providers are designed to be replaceable. Each operator will configure their own provider projects, credentials and deployment. See [CONTRIBUTING](CONTRIBUTING.md) and the [architecture review](docs/architecture-review-2026-09.md) for how to pick a slice; [build status](docs/build-status.md) is the scoreboard. Pull requests and pushes to `main` run GitHub Actions CI: `bun install --frozen-lockfile` then `bun check`. Live probes stay opt-in and are not enabled in CI.

Never commit credentials or funded-wallet secrets. Documented token/provider support is separate from a tested integration.

## License

Original repository content is licensed under [MIT](LICENSE). Linked third-party materials, provider SDKs and trademarks retain their respective terms.
