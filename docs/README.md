# Docs

Home documentation is split by job: run a clone, customize it, or read design intent. **Current delivery state is [build status](build-status.md)** (snapshot September 8, 2026). Design docs describe the intended product and production architecture; they are not a feature inventory.

If you want to run or fork Home, start with the root [Get started](../README.md#get-started) path and [Fork and extend](fork-and-extend.md).

## Run & operate

| Doc | Use it for |
|---|---|
| [Fork and extend](fork-and-extend.md) | Brand, regions, assets, provider seams, local-spike vs production persistence |
| [UI PR previews](pr-previews/README.md) | Screenshot convention for user-visible UI / core-flow PRs (before+after preferred) |
| [CDP setup](cdp-setup.md) | Your CDP project, `localhost` origin, email login, server validation, privacy defaults |
| [CDP SQL](cdp-sql.md) | Indexed Base history adapter, auth modes, bounded smoke tests |
| [Base Account](base-account.md) | Optional SIWE path (`NEXT_PUBLIC_ENABLE_BASE_ACCOUNT`); not enabled by default |
| [Morpho setup](morpho-setup.md) | USDC vault candidates and read verification; deposit/withdraw status is in [build status](build-status.md) |
| [Wallet runtime spike](wallet-runtime-spike.md) | Prepare → claim → sign → reconcile; **SQLite under `.local/` is local-spike only** |
| [Build status](build-status.md) | What is integrated, validation evidence, remaining gates |
| [Codex prices](codex-prices.md) | Optional server-only Invest USD snapshots |
| [Portfolio](portfolio.md) | USDC/ETH reads, regional valuation, `BASE_RPC_URL` |

`apps/web/server/borrowing/README.md` documents the single cbBTC/USDC Morpho market used by the local Borrow spike.

## Design & product

These documents are intent and review material. Status headers point here only for architecture; check [build status](build-status.md) before assuming a paragraph is implemented.

| Doc | Use it for |
|---|---|
| [Product scope](product-scope.md) | Livestream UX, roadmap, two-hour build order |
| [Technical design](technical-design.md) | Production architecture, provider boundaries, **Neon/Postgres** target, Vercel deployment |
| [Implementation plan](implementation-plan.md) | Intended chunks and acceptance checks |
| [UI direction](ui-direction.md) | Color, type, feature-module surface rules |
| [Regional money](regional-money.md) | Native-currency presentation and candidate mapping |
| [Public transfer feed spec](public-transfer-feed-spec.md) | Specified public ERC-20 transfer feed; not a delivery claim |

## Data / registries

| Doc | Use it for |
|---|---|
| [Currency defaults](currency-defaults.md) | Confirmed default token per currency (including **CADD** and **wARS**) |
| [Stablecoin candidates](stablecoin-candidates.json) | Sourced Base contract metadata; verification pending, funding disabled |
| [Invest data](invest-data.md) | Stock/meme identities and price/eligibility boundaries |

Code registries that match these docs: `apps/web/config/regions.ts`, `apps/web/config/invest-assets.ts`, `apps/web/config/portfolio-assets.ts`.
