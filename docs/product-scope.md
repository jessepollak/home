# Home — livestream product and technical scope

Status: product intent and livestream UX draft. A local finance spike exists in `apps/web/`; this file is **not** current delivery state or an implementation checklist.
Current delivery: [build status](build-status.md). Current tree: [architecture review](architecture-review-2026-09.md). Run: [Get started](../README.md#get-started), [fork and extend](fork-and-extend.md).
Date: 2026-09-07 (header updated 2026-09-08)

Proposed production architecture (not the current tree): [target architecture](target-architecture.md) (Vercel, Neon/Postgres, CDP webhooks). Historical livestream chunks: [archived implementation plan](archive/implementation-plan-2026-09-07.md).

## Recommendation

Build a mobile-first web app: Home, an open-source home for your money on Base.
The demo story is local money → global opportunity, with email sign-in and gas-sponsored smart-account actions.
Target a live deployed app with a polished shell, email login, persistent user/operation records and one confirmed Base money action in 120 minutes. Build locally first and deploy in the final release step; additional execution paths depend on preflight results.
React Native offers better native feel, and CDP supports it, but web gives livestream viewers an immediate URL and faster iteration. Reuse typed configuration and integration adapters in a later native app; do not promise automatic UI portability.

## Product scope

- Welcome: suggest country from approximate IP geolocation on first open, then show local currency and regional styling before email sign-in. Keep a visible country/language override and remember the choice. Saved preferences beat subsequent detection; unsupported or missing detection gets a neutral welcome. Country selection sets presentation defaults; provider eligibility remains separately enforced.
- Home: lead with native currency names and symbols (e.g. Brazilian real / R$), with the token/issuer secondary in details and transaction review. Show actual local-stablecoin holdings first; separate dollar savings and investments. Add money, send, receive, and activity. Converted portfolio values carry an estimate label and price timestamp.
- Save: one selected USDC vault, current variable APY and source, deposit/withdraw preview, position and withdrawal status. Explain the USD exposure when converting local currency into USDC.
- Invest: a short verified list of Coinbase tokenized stocks on Base. Discovery stays a product list: no contract walls, restriction notes, source rosters, or eligibility essays on the screen. Enable execution only after eligibility and the exact route are verified. Legal copy belongs under Account → Disclosures / Terms.
- Explore: a small curated Base meme corner, below the financial essentials. Use a Base-only address allowlist; presence on Base alone does not make a token a Base-origin meme.
- Add money: Coinbase Onramp for US USDC; Onramper for verified local routes. Prefill the selected asset/network and smart-account address. Planned routes display “coming soon.”

Default navigation: Home / Save / Invest; meme corner lives within Invest or Explore rather than taking equal billing with the balance.

## Extended feature roadmap

Roadmap as of 2026-09-07. These belong in the overall Home feature list but are low priority for today's stream; pursue only after the core demo is complete and time remains. Provider choices below describe intended integrations, not verified availability.

- Borrow: Coinbase-style borrowing against crypto assets and tokenized stocks, using Coinbase wrapped assets and suitable Morpho lending markets. Show eligible collateral, borrowing capacity, interest rate, loan health/liquidation threshold, and repay/manage-collateral flows. Verify each collateral asset and market before enabling it; stock collateral support is not assumed.
- Agent: an agentic interface powered by Venice, exploring x402 and/or $DIEM for inference access/payment. Help users understand balances and positions, then prepare supported Home actions for user review. Confirm Venice integration and payment mechanics before selecting the implementation; reuse Home's transaction adapters and explicit signing flow.
- Spend: a Rain-powered debit card with Base settlement. Target card onboarding, card controls, spending balance, and transaction activity. Verify Rain program access, supported regions, funding model, and settlement integration before implementation.

These additions do not displace the 120-minute build checkpoints below. If reached today, start with a clearly labeled concept or sandbox flow; live execution depends on verified integration readiness.

## Design direction

Warm neutral surfaces, near-black typography, generous space, oversized balances, restrained motion, and a simple lowercase “home” wordmark. Base blue is the common brand anchor. A region accent changes the welcome illustration, account surface and primary action without repainting every component.

Localize welcome copy, language, number formatting, fiat unit, actual default stablecoin and available payment methods. Keep country and language independently editable. Use the [sourced regional roster](regional-money.md); choose US plus two non-US demo regions after issuer/route verification. Make country → currency → exact Base asset configuration-driven.

Do not equate a local-currency display conversion with a local-stablecoin balance. Do not show “1:1” or “zero fee” without a confirming quote/access entitlement. The product may use a neobank-inspired design while accurately identifying the underlying wallet, asset and yield product.

## Two-hour build order

| Minutes | Deliverable / checkpoint commit |
|---|---|
| 0–20 | Build local Next/TypeScript/Tailwind shell, region/theme config, geo fixtures/override and development database connection |
| 20–40 | CDP email login, smart account, saved region/preferences and balances |
| 40–70 | Receive/send, shared review, persistent operation records and receipt reconciliation; small Base transaction from the local app |
| 70–90 | One verified onramp handoff, local signed-webhook tests and return/status fallback |
| 90–105 | Stretch: verified local funding, Morpho save/withdraw or CDP trade; otherwise finish core gaps |
| 105–120 | First Vercel deployment, production config/migrations, real geo/webhook smoke tests, README and walkthrough |

The timebox includes publishing and checks. Success is a live app with real authentication, persistent records and a money action whose status survives refresh. Reduce feature breadth if behind. Use CDP SQL API for indexed history and CDP/RPC for balances/receipts; no standalone Ponder deployment. Keep database persistence in the local build; deploy at the end of the stream. Use the optional feature slot as release buffer if needed.

## Technical scope

Proposed stack (livestream / production destination — **not** what `bun dev` uses today; current spike is Next.js + local SQLite, see [build status](build-status.md)): Next.js + TypeScript + Tailwind, CDP React user-wallet SDK, viem for onchain reads/encoding, a Next.js server API for provider credentials, onramp sessions and quotes, and PostgreSQL + Drizzle from day one. Use CDP SQL API for history and CDP/RPC for current balances/receipts. Deployment: Vercel for web/API, CDP webhook handling and request-driven status checks, Neon Postgres provisioned through Vercel Marketplace. No separately hosted Ponder service. Pin the compatible dependency set during scaffold; use bun where supported.

- Wallet: CDP email OTP with smart-account creation. The end-user wallet signs actions; do not substitute a server-controlled wallet. Use the smart account as the destination and balance owner consistently.
- Network: Base mainnet for verified assets; isolated testnet/demo configuration for rehearsals. Never mingle fixture balances and actual assets.
- Gas: paymaster sponsorship for supported actions, with contract/action allowlists and per-user/project spending limits.
- Geo: resolve Vercel’s country header on first render, with saved/manual choice taking precedence. No GPS prompt or extra service. Match language independently, avoid shared caching of personalized responses, and treat detection only as presentation.
- Regions: typed records of country, locales, fiat code, theme, Base token address/decimals, provider asset IDs, route status and evidence timestamp. Keep display preferences distinct from residency/eligibility.
- Onramps: provider-hosted checkout first. Query assets → payment methods → quote. Track pending/completed/failed provider status and reconcile onchain balance. A checkout return URL does not prove funds arrived.
- Trading: one quote/execute adapter, initially evaluate CDP Trade API for supported Base routes. Builders verify exact stock and meme contracts, liquidity, token restrictions and smart-account compatibility in the registry and docs; product list UI must not surface those records. Review/confirm may show expiry, fees, slippage, minimum received and impact before signing.
- Yield: one verified Morpho USDC vault on Base. Read vault-specific configuration, APY, positions and available withdrawal liquidity. Use its documented deposit/redeem flow, simulate calls, and refresh state after a receipt. No custom contracts, strategy router or auto-rebalancing.
- Activity: pending/submitted/confirmed/failed states, receipt links and balance refresh. Track user-operation status through to the actual transaction receipt. Persist users, preferences and operations in app-owned Postgres tables. Use CDP wallet/onramp/Base activity webhooks for updates while the user is away; refresh unresolved operations after submission and on reopen as a fallback. A Vercel endpoint verifies signatures and deduplicates events before updating Postgres; chain confirmation still uses receipts. No cron in the initial build; stored status may wait until the next visit when no webhook arrives. Merge Home-initiated actions with CDP SQL transfer/smart-account history after validating actual asset coverage; cache and budget paid SQL queries.
- Open source: separate public Home repository, MIT license, README, .env.example without secrets, typed asset/region registries, clearly isolated demo data. Checkpoint commits with pushes and a visible commit link; verify the public deployment before announcing it.

## Preflight before going live

The dashboard and source registry are identified in the [regional money specification](regional-money.md); demo regions and default issuers remain to be selected against verified routes. Builder verifies CDP project/origins, email login, paymaster funding/policies, Vercel/Marketplace database access, CDP webhook subscriptions/signing secrets and transaction-status refresh, Onramper access and exact routes, Coinbase zero-fee access if advertised, stock eligibility/integration requirements, one vault and its withdrawal path. Provision a small demo balance so settlement delays cannot consume the stream. Keep OTP, credentials and personal account screens off the broadcast.

Preparation is separate from the 120-minute estimate. Rehearse credentials and one transaction route so live deployment, login, persistence and a confirmed money action are achievable during the stream; trim extra features if setup runs long.

## Verification and operating boundary

Smoke-test fresh login/relogin, correct smart-account funding, region changes, rejected/expired quotes, transaction rejection and receipt reconciliation. Verify signed CDP webhook delivery, invalid-signature rejection and duplicate handling. Verify a small deposit and withdrawal before presenting yield as operational. Check mobile layout, typecheck/build and secret hygiene before each public release.

The builder owns provider failures, stale quotes, sponsorship costs and transaction support while the demo is live. A wrong address or signing payload can lose user funds; fail closed on unsupported or unverified routes. Public mainnet access beyond the controlled demonstration is a separate release decision with an operating owner.

## Deferred

Borrowing, the Venice agentic interface, and the Rain debit card are stretch features as specified above. Other deferred work: native app, bank account numbers, bill pay, automated savings, broad asset search, complete transaction indexing, crosschain assets, new contracts and every-country onramp execution. Highest-value next addition: local currency → USDC conversion with a clear quote, linking local money to dollar saving and investing. Add offramping next to complete the money loop.

## Sources checked

- [CDP user wallet quickstart](https://docs.cdp.coinbase.com/wallets/quickstart/user-auth): email login and smart-account configuration.
- [CDP React Native quickstart](https://docs.cdp.coinbase.com/wallets/client-side-development/react-native): native option is supported.
- [Coinbase Onramp FAQ](https://docs.cdp.coinbase.com/onramp/additional-resources/faq): zero-fee USDC requires enabled access.
- [Onramper assets](https://docs.onramper.com/reference/get_supported-assets), [payment methods](https://docs.onramper.com/reference/get_supported-payment-types-source), [widget parameters](https://docs.onramper.com/docs/supported-widget-parameters): route discovery, quote validation and prefilling.
- [Base stocks](https://brand.base.org/stocks), [builder announcement](https://blog.base.org/request-for-builders-tokenized-stocks): Coinbase-issued tokenized stocks and eligible non-US availability.
- [CDP Trade API](https://docs.cdp.coinbase.com/trade-api/welcome): Base swaps and smart-account support; exact token routes remain unverified.
- [Morpho vault API](https://docs.morpho.org/developers/api/morpho-vaults/): vault configuration, APY, positions and withdrawal data.

The [dashboard source registry](https://dune.com/queries/4780995) has now been read and preserved in the regional money specification. It lists 21 non-USD currencies; issuer verification and live funding routes remain separate checks. No universal local 1:1 availability is asserted.

- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage): provision Neon Postgres through Vercel. Ponder is deferred to keep deployment within Vercel.

- [CDP SQL API](https://docs.cdp.coinbase.com/data/sql-api/welcome), [schema](https://docs.cdp.coinbase.com/data/sql-api/schema): proposed indexed Base history provider; documented fit verified, authenticated query testing remains preflight work.

- [CDP webhooks](https://docs.cdp.coinbase.com/webhooks/overview), [onramp events](https://docs.cdp.coinbase.com/webhooks/onramp): documented wallet lifecycle, funding status and Base activity notifications; subscription setup and delivery testing remain preflight work.

- [Vercel geolocation](https://vercel.com/kb/guide/geo-ip-headers-geolocation-vercel-functions): country headers available on deployments; local development needs fixtures.
