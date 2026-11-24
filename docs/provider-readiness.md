# Provider readiness

This page lists every external provider a third-party operator needs to run Home: the account, the approval and who grants it, typical lead time, cost model, and whether launch needs it. It names environment variables only; the root [`.env.example`](../.env.example) has every name with its comment, and the [operator checklist](operator-checklist.md) says where each value is set.

Lead times and prices come from each provider's public pages, checked 2026-11-22. They change; confirm with the provider before you budget. "Unknown — ask the provider" means no public source states it.

## Start this week

Accounts that only need a sign-up can be ready the same day. Start these first, because each waits on a review by the provider:

1. **Coinbase Onramp production access** if you will offer US Apple Pay deposits. You apply in the CDP Portal; there is no published approval time.
2. **A card program** (Bridge with Stripe Issuing, or Immersve) if you will offer a card. Both are business partnerships with a program review.
3. **Ripio** (Argentina, Brazil, Colombia) or **IDRX** (Indonesia) if you will offer local money in or out there. Both require company KYB.

Home launches without any of these: deposits from another wallet, sending, Savings, and Invest work without a funding or card provider. A corridor or card program stays off until its credentials are set and you turn it on.

## Required for launch

| Provider | Account | Approval, and who grants it | Lead time | Cost model | Environment variables | Setup |
| --- | --- | --- | --- | --- | --- | --- |
| Vercel (hosting) | A Vercel team on the Pro plan. Hobby is for personal, non-commercial use only. | Self-serve sign-up. | Same day | Pro: $20/month including one deploying seat and $20 of usage credit; each additional deploying seat $20/month; usage past the credit is billed. [Pro plan](https://vercel.com/docs/plans/pro-plan), [Hobby plan](https://vercel.com/docs/plans/hobby) | `VERCEL_*` are injected by Vercel. Set `HOME_ACCESS_*` and `HOME_OPERATOR_ADDRESSES` there. | [Vercel deploy](vercel-deploy.md#launch) |
| PostgreSQL 14+ (for example Neon) | A database project with a production connection string. | Self-serve sign-up. | Same day | Neon Free: $0 with compute and storage limits. Neon Launch: no monthly minimum; usage at $0.106 per compute-unit hour and $0.35 per GB-month. [Neon plans](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md) | `DATABASE_URL`, optional `HOME_MIGRATE_ON_BUILD`. Preview branches add `NEON_API_KEY` and `NEON_PROJECT_ID` as GitHub Actions settings. | [Vercel deploy](vercel-deploy.md#environment), [Neon preview branches](vercel-deploy.md#neon-preview-branches) |
| Coinbase Developer Platform (CDP) project and server key | A CDP project, its project ID, and a server API key. Add every app origin to the Embedded Wallet allowed origins. | Self-serve sign-up in the CDP Portal. | Same day | Embedded Wallets: 5,000 wallet operations a month free, then $0.005 per operation ([announcement](https://www.coinbase.com/developer-platform/discover/launches/embedded-wallets-ga)). Server APIs Home uses (SQL, address history, token balances, swaps, webhooks): unknown — ask the provider, or check billing in the CDP Portal. | `NEXT_PUBLIC_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`; optional `CDP_SQL_AUTH_MODE`, `CDP_SQL_CLIENT_API_KEY`, `ACTIVITY_HISTORY_SOURCE`, `HOME_WEBHOOK_ORIGIN`, `DISABLE_CDP_USAGE_TRACKING`, `DISABLE_CDP_ERROR_REPORTING` | [CDP setup](cdp-setup.md), [CDP SQL](cdp-sql.md#authentication-decision), [balance webhook](vercel-deploy.md#cdp-balance-activity-webhook) |
| Base RPC (CDP Node) | A Base mainnet HTTPS endpoint from CDP Portal → Node. It uses the same CDP project. | Self-serve. | Same day | Free, rate-limited endpoint ([CDP Node](https://www.coinbase.com/developer-platform/products/node)). Higher limits: unknown — ask the provider. | `BASE_RPC_URL`. Without it, local development falls back to the rate-limited public endpoint, which is not for production. | [`.env.example`](../.env.example), [Vercel deploy](vercel-deploy.md#environment) |
| Codex (market data) | A Codex API key. Prices, balance values, Invest discovery, and historical Activity values depend on it. | Self-serve sign-up. | Same day | Free plan: $0 a month after a one-time $1 activation, 10,000 compute units a month at 5 requests a second. Growth: from $360 a month. [Codex pricing](https://www.codex.io/pricing) | `CODEX_API_KEY` | [Codex prices](codex-prices.md#server-setup) |

The Free Codex plan suits a trial; a launched instance with real traffic should expect a paid plan. Compute units are not the same as requests.

## Optional at launch

| Provider | What it enables | Account | Approval, and who grants it | Lead time | Cost model | Environment variables | Setup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CDP Paymaster | Customers pay network fees in USDC instead of ETH. | A paymaster and bundler endpoint in the same CDP project. | Self-serve in the CDP Portal. | Same day | You are billed for sponsored gas plus a service fee shown in the CDP Portal. The rate: unknown — ask the provider. | `CDP_PAYMASTER_URL` | [CDP setup](cdp-setup.md#local-setup) |
| Ethereum RPC | `.eth` recipient names. | Any Ethereum mainnet HTTPS RPC provider. | Self-serve with most providers. | Same day | Depends on the provider; many have a free tier. | `ETHEREUM_RPC_URL`. Unset uses a public fallback; set a dedicated endpoint in Production and Preview. | [`.env.example`](../.env.example) |
| Coinbase Onramp (Embedded Orders) | US deposits by Apple Pay. Home has no Coinbase cash-out binding. | Onramp enablement on the CDP project, an Onramp domain allowlist (separate from Embedded Wallet origins), a domain-verification file on every production and preview domain, and Apple Pay domain enablement. | Coinbase reviews and grants production access ([Headless Onramp](https://docs.cdp.coinbase.com/onramp/headless-onramp/overview)). The sandbox works before approval. | Unknown — ask the provider. No published approval time. | Free to integrate. Customers pay the Coinbase fees shown at checkout. | Uses the CDP server key. `FUNDING_QUOTE_SECRET` (you generate it) is required for any funding provider. `COINBASE_ONRAMP_MODE` is for local sandbox runs only. | [Coinbase provider](../apps/web/server/funding/providers/coinbase/README.md#iframe-and-domain-requirements), [funding provider seam](funding-provider-seam.md) |
| Peer | Cash out Base USDC through Peer's onchain escrow. | None. Peer has no credentials; Home uses its published contracts. | No provider approval. You turn on each corridor in Admin → Settings → Money in and out. | None | Peer's fees to customers: unknown — ask the provider. | `PEER_OFFRAMP_ENABLED` (legacy switch, ignored after the first save of Money in and out); `PEER_OFFRAMP_MODE` is for local runs only. | [Peer provider](../apps/web/server/funding/providers/peer/README.md#implementation-and-enablement-gates) |
| Ripio Ramps | Local money in and out in Argentina, Brazil, and Colombia. | A Ripio organization, with production credentials and a webhook secret per country. | Ripio grants production after company KYB ([Ripio platform](https://platform.ripio.com/)). There is no sandbox. | Unknown — ask the provider. | Colombia's published terms: no integration fee, USD 1 per end-user KYC, 0% between local currency and its matching stablecoin, 1% on other assets ([Colombia terms](https://terms.ripio.com/co/ramps-api-colombia)). Argentina and Brazil: unknown — ask the provider. | `RIPIO_CLIENT_ID_<country>`, `RIPIO_CLIENT_SECRET_<country>`, `RIPIO_WEBHOOK_SECRET_<country>` for `AR`, `BR`, `CO` | [Ripio provider](../apps/web/server/funding/providers/ripio/README.md#confirm-against-your-api) |
| IDRX | Indonesian rupiah deposits by QRIS. | An IDRX business account with API access. | IDRX verifies the company's documents and grants access ([getting started](https://docs.idrx.co/api/getting-started)). There is no sandbox. | About 3 working days after a complete submission, per IDRX. | Published per-transaction fees, for example 0.7% for QRIS up to Rp10,000,000 ([IDRX fees](https://docs.idrx.co/services/fees)). Business or API fees: unknown — ask the provider. | `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, `IDRX_CUSTOMER_NAME` | [IDRX provider](../apps/web/server/funding/providers/idrx/README.md) |
| Bridge with Stripe Issuing | A card funded from the customer's Base USDC. | A Bridge card program, plus a Stripe account for Issuing events and card display. | Bridge reviews the business and program ([Bridge cards](https://bridge.xyz/product/cards)). | Unknown — ask the provider. | No public rate card: unknown — ask the provider. | `BRIDGE_*`, `CARD_PROGRAM_DEFAULT`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | [Cards](cards.md#provider-seam) |
| Immersve | An alternative card program. | An Immersve partner account, with your own card program, funding channel, and funds storage. | Immersve reviews the partner application, then provisions test and then live credentials ([contact](https://immersve.com/contact)). | Unknown — ask the provider. Immersve says it replies to enquiries within one business day. | An all-inclusive per-transaction fee; no public rate ([pricing](https://immersve.com/pricing/)). | `IMMERSVE_*` | [Cards](cards.md#environments) |

## No account needed

These run without a sign-up, but some depend on the required accounts above:

- **Base Account sign-in.** Needs only `HOME_SESSION_SECRET`, which you generate ([Base Account](base-account.md)).
- **Savings (Morpho vaults).** Reads Morpho's public API and the vault contracts over `BASE_RPC_URL`; no key ([Morpho setup](morpho-setup.md)).
- **Invest trades.** Quoted and built through CDP swaps with the CDP server key. The economics are in each quote.
- **Tokenized stocks.** Coinbase-issued tokens on Base, priced from onchain Chainlink feeds over `BASE_RPC_URL`. Trades use CDP swaps, which currently refuse stock routes, so stocks are view-only ([Invest data](invest-data.md)).
- **Token risk, `.eth` reverse names, and Base Account status.** GoPlus and ENS Ideas public APIs, and the Coinbase Wallet status RPC (`BASE_ACCOUNT_STATUS_RPC_URL` overrides it, for tests only).

## Secrets you generate

No provider issues these. Generate them yourself and set them in Vercel: `HOME_SESSION_SECRET`, `FUNDING_QUOTE_SECRET`, `HOME_ACCESS_PASSWORD` and `HOME_ACCESS_SIGNING_SECRET` ([pre-release access](vercel-deploy.md#pre-release-production-access)), `HOME_SECRET_ENCRYPTION_KEY` and `HOME_SECRET_KEY_VERSION` ([secrets at rest](secrets-at-rest.md)), and `ACCOUNT_DELETION_TOMBSTONE_SECRET` ([Leave Home](account-deletion.md)).

The `HOME_VERIFY_*` variables are for the project's own live-verification runners; an operator instance does not need them.
