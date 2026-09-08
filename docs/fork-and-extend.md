# Fork and extend

Status: operator guide for the local finance spike, September 8, 2026. This is how to clone Home and replace brand, regions, assets, and providers. It is not a contribution process and does not authorize production use. Current delivery: [build status](build-status.md).

Home is meant to be forked. Brand, regions, asset selection, and providers are compile-time configuration in this repository. Each operator provisions their own CDP project, credentials, and deployment. Upstream pull requests are optional; see the root README if you send one.

## Start from a running clone

Follow [Get started](../README.md#get-started) first: `bun install --frozen-lockfile`, copy `.env.example` to `apps/web/.env.local` without overwriting an existing file, then `bun dev`. Browsing works without credentials. Email sign-in and authenticated money actions need your own CDP project.

Then change configuration in place. Typed registries live under `apps/web/config/`. Provider seams live under `apps/web/server/` and the matching setup docs below. Keep one root `bun.lock`.

## Brand

| What | Where |
|---|---|
| App name, description, repository URL | `apps/web/config/brand.ts` (consumed by `apps/web/app/layout.tsx` metadata) |
| Color tokens and control radii | `apps/web/app/globals.css` (`--home-*` variables). Direction: [UI direction](ui-direction.md) |
| Home / Save / Invest labels | `apps/web/config/navigation.ts` |
| Shell and feature UI | `apps/web/app/home-experience.tsx`, `apps/web/features/` |
| Animated Home mark | `apps/web/components/home-mark.tsx` and `apps/web/public/home-mark/` |

The Home mark fonts are **not** MIT-licensed. Read `apps/web/public/home-mark/PROVENANCE.md` before copying or redistributing those files. A fork that keeps the mark needs its own permission for Base Sans; Doto is SIL OFL.

Do not treat Base brand assets, trademarks, or provider names as yours. Replace name, description, and visual tokens before publishing a fork.

## Regions and currency presentation

Country selection is presentation, not eligibility, residency, or a funding unlock.

| What | Where |
|---|---|
| ISO country roster, fiat codes, welcome copy, accent | `apps/web/config/regions.ts` (`presentationRegions`, `resolvePresentation`) |
| Anonymous remembered country | `apps/web/config/country-preference.ts` |
| Native-currency UI rules | [Regional money](regional-money.md) |
| Confirmed default token per currency | [Currency defaults](currency-defaults.md) |

Changing country updates labels, formatting, and default cash presentation. It does not convert holdings or enable a route. Adding a country means a typed region record plus a verified Base asset later — not a ticker in copy. Local development has no Vercel geo header; the resolver falls back to `GLOBAL` unless the visitor picks a country.

## Asset inventories

Contract identity is always chain ID + address. Display tickers are labels only.

| Inventory | File | Notes |
|---|---|---|
| Invest stocks / wrapped crypto / memes | `apps/web/config/invest-assets.ts` | Display vs token representation. Details: [Invest data](invest-data.md) |
| List/detail labels | `apps/web/config/asset-presentation.ts` | |
| Wallet cash, native ETH, vault list used in valuation | `apps/web/config/portfolio-assets.ts` | USDC/ETH quantities vs regional valuation: [Portfolio](portfolio.md) |
| Sourced Base stablecoin metadata | [stablecoin-candidates.json](stablecoin-candidates.json) | Verification pending; assets stay disabled until you verify them |

Prices are optional and server-only ([Codex prices](codex-prices.md)). Presence in a registry is not a trade route, redemption, or eligibility decision.

## Provider seams

Operators bring their own projects. Nothing in this repo is a shared CDP, Morpho, or Codex account.

| Seam | Config / env | Doc |
|---|---|---|
| Email sign-in, session validation | `NEXT_PUBLIC_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | [CDP setup](cdp-setup.md) |
| Indexed ERC-20 history | `CDP_SQL_AUTH_MODE`, `CDP_SQL_CLIENT_API_KEY` | [CDP SQL](cdp-sql.md) |
| Optional Base Account SIWE | `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT` | [Base Account](base-account.md) |
| Morpho USDC vault shortlist | `apps/web/server/morpho/config.ts` (keep in sync with `portfolioVaults`) | [Morpho setup](morpho-setup.md) |
| One cbBTC/USDC borrow market | `apps/web/server/borrowing/config.ts` | `apps/web/server/borrowing/README.md` |
| Invest USD indications | `CODEX_API_KEY` | [Codex prices](codex-prices.md) |
| Base RPC | optional server-only `BASE_RPC_URL` | [Portfolio](portfolio.md) |

Copy the root `.env.example` into gitignored `apps/web/.env.local`. Never commit secrets or use a `NEXT_PUBLIC_` prefix on server keys. Add `http://localhost:3000` (and each deployed origin) to **your** CDP project. Live probes stay opt-in; do not enable them as defaults.

Changing a vault or market address is not enough: adapters check chain, exact contracts, decimals, and (for borrow) oracle/IRM/LLTV. Verify against issuer and protocol docs before enabling a product.

## Local spike vs production

The running app is a **local finance spike**, not a production-approved deployment. See [build status](build-status.md) and [wallet runtime](wallet-runtime-spike.md).

| Local spike (what `bun dev` uses) | Hosted / proposed production |
|---|---|
| Node `node:sqlite` money-action store under `.local/` when `DATABASE_URL` is unset | Neon Postgres `MoneyActionStore` when `DATABASE_URL` is set ([Vercel deploy](vercel-deploy.md)); Drizzle/webhooks still [target architecture](target-architecture.md) |
| No webhooks or CDP-hosted shared history write path | CDP webhooks, request-driven status, isolated preview/production databases |
| Public Base RPC by default | Operator-managed `BASE_RPC_URL` |
| Durable operations recoverable on this machine only (SQLite) | Shared money-action rows on Neon when `DATABASE_URL` is configured |

`MoneyActionStore` stays injectable. Exactly one adapter is active per process. Do not point a fork at someone else's database or CDP project. Bun monorepo Vercel settings are in [Vercel deploy](vercel-deploy.md).

Venice/agent inference, Rain cards, additional funding providers, unrestricted assets, and broader borrow markets are not implemented. Stock trading and external Base-account trading remain gated.

## After you customize

- Keep configuration and secrets out of git. `.env.local` is gitignored; use permission `0600` for real keys.
- Country, language, and eligibility stay separate. A region switch must not imply residency or unlock a restricted stock.
- Exact asset, network, and user approval remain part of financial review. Documented token support is not a tested live integration.
- `bun check` is the same gate CI runs (`bun install --frozen-lockfile` then `bun check`) if you send a focused PR. User-visible UI / core-flow PRs should attach before/after images in a table in the GitHub PR description ([UI PR previews](ui-pr-previews.md)).
