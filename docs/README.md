# Docs

**Current delivery state is [build status](build-status.md)** (snapshot September 8, 2026). Start there, then the money-action contract and the current-tree review. Target/production-destination docs are demoted below so they cannot be mistaken for the live app.

If you want to run or fork Home, start with the root [Get started](../README.md#get-started) path and [Fork and extend](fork-and-extend.md). Sending a focused PR or joining as a second engineer is optional — see [CONTRIBUTING](../CONTRIBUTING.md). The in-repo agent crew follows the [operating manual](operating-manual.md).

## Current tree (read first)

| Doc | Use it for |
|---|---|
| [Build status](build-status.md) | What is integrated, validation evidence, remaining gates |
| [Wallet runtime spike](wallet-runtime-spike.md) | Prepare → claim → sign → reconcile; SQLite locally, Neon/Postgres when `DATABASE_URL` is set |
| [Attempt-aware onchain transactions](onchain-transaction-architecture.md) | Decision, failure windows, pure status checks, attempt/evidence target, migration and staged implementation |
| [Architecture review](architecture-review-2026-09.md) | Current-tree patterns, risks, contribution contract, first-week slices |

## Run & operate

| Doc | Use it for |
|---|---|
| [Operating manual](operating-manual.md) | Agent-team roles, GitHub issue labels, proof bar, Jesse-only merge |
| [Fork and extend](fork-and-extend.md) | Brand, regions, assets, provider seams, local-spike vs production persistence |
| [UI PR previews](ui-pr-previews.md) | Before/After **table** of inline embeds preferred when both exist; after-only OK when before isn’t useful |
| [CDP setup](cdp-setup.md) | Your CDP project, `localhost` origin, email login, server validation, privacy defaults; [preview vs production auth](cdp-setup.md#preview-auth) |
| [CDP SQL](cdp-sql.md) | Indexed Base history adapter, auth modes, bounded smoke tests. Not balances. |
| [Base Account](base-account.md) | Optional SIWE path (`NEXT_PUBLIC_ENABLE_BASE_ACCOUNT`); not enabled by default |
| [Morpho setup](morpho-setup.md) | USDC vault candidates and read verification; deposit/withdraw status is in [build status](build-status.md) |
| [Codex prices](codex-prices.md) | Optional server-only Invest USD snapshots |
| [Portfolio](portfolio.md) | USDC/ETH reads, Token Balances inventory, regional valuation, device presentation cache, `BASE_RPC_URL`. Phase B/C: [inventory summary](balances-inventory-architecture.md) |
| [Vercel deploy](vercel-deploy.md) | Bun monorepo install/build on Vercel; hosted money actions need Neon `DATABASE_URL`; [preview auth / CDP CORS](vercel-deploy.md#preview-auth); preview branch cleanup Actions |

`apps/web/server/borrowing/README.md` documents the single cbBTC/USDC Morpho market used by the local Borrow spike.

## Product intent

These describe UX and presentation rules. They are not a feature inventory.

| Doc | Use it for |
|---|---|
| [Product scope](product-scope.md) | Livestream UX and roadmap intent. An app exists; this is not delivery state. |
| [UI direction](ui-direction.md) | Color, type, feature-module surface rules |
| [Regional money](regional-money.md) | Native-currency presentation and candidate mapping |
| [Public transfer feed spec](public-transfer-feed-spec.md) | Specified public ERC-20 transfer feed; not a delivery claim |

## Target / archive (not the current tree)

Do not start a clone or a PR from these. Webhooks, Drizzle, and `packages/*` remain production-destination ideas. A Neon money-action adapter is already in the current tree when `DATABASE_URL` is set.

| Doc | Use it for |
|---|---|
| [Target architecture](target-architecture.md) | Proposed Vercel + Neon/Postgres + webhook design. Formerly `docs/technical-design.md`. |
| [Balances inventory](balances-inventory-architecture.md) | Locked inventory direction (Phase A shipped in #80; B/C not in tree). Full research on [#76](https://github.com/jessepollak/home/issues/76). |
| [Archived implementation plan](archive/implementation-plan-2026-09-07.md) | 2026-09-07 two-hour chunk plan. [build status](build-status.md) is the scoreboard. |
| [Archive index](archive/README.md) | What was moved and why |

Old URLs still resolve: [technical-design.md](technical-design.md) and [implementation-plan.md](implementation-plan.md) are short stubs.

## Data / registries

| Doc | Use it for |
|---|---|
| [Currency defaults](currency-defaults.md) | Confirmed default token per currency (including **CADD** and **wARS**) |
| [Stablecoin candidates](stablecoin-candidates.json) | Sourced Base contract metadata; verification pending, funding disabled |
| [Invest data](invest-data.md) | Stock/meme identities and price/eligibility boundaries |

Code registries that match these docs: `apps/web/config/regions.ts`, `apps/web/config/invest-assets.ts`, `apps/web/config/portfolio-assets.ts`.
