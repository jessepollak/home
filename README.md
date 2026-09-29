# Home

**The WordPress for neobanks.**

Home is open-source software for running a branded neobank on Base. Operators — businesses serving a country, a community, or an audience — bring their customers, brand, and regional know-how. Home supplies the product and the technology: a polished customer app for holding, earning, sending, investing, and borrowing, plus the provider integrations and operator console behind it.

> **Development status:** Home is under active development. It is not production-authorized or a real-money deployment.

Delivery work is tracked in repository issues. Jesse adds the `factory` label when the factory should start; see the [operating manual](docs/operating-manual.md).

## Product

Real browser captures of the current app, rendered with sample data. Select an image for full size.

<table>
  <tr>
    <td align="center" valign="top">
      <a href="docs/readme/home.png"><img src="docs/readme/home.png" width="250" alt="Sample-data capture of the Home dashboard with total balance, Add money and Send, Your money, and a pending cash-out in Activity"></a><br>
      <strong>Home</strong><br><sub>Balance, money, and Activity</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/readme/asset.png"><img src="docs/readme/asset.png" width="250" alt="Sample-data capture of the Bitcoin asset detail with a one-week price chart, range selector, balance, stats, and Buy and Sell"></a><br>
      <strong>Asset detail</strong><br><sub>Price chart, holding, and stats</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/readme/home-dark.png"><img src="docs/readme/home-dark.png" width="250" alt="Sample-data capture of the Home dashboard in dark appearance"></a><br>
      <strong>Dark mode</strong><br><sub>Light, Dark, or System</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/readme/cash.png"><img src="docs/readme/cash.png" width="250" alt="Sample-data capture of the Cash screen with a US dollar stablecoin balance and savings"></a><br>
      <strong>Cash</strong><br><sub>Stablecoin currencies and savings</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/readme/savings.png"><img src="docs/readme/savings.png" width="250" alt="Sample-data capture of a savings position tray with saved amount, variable APY, Deposit more, and Withdraw"></a><br>
      <strong>Savings</strong><br><sub>Per-position management</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/readme/invest.png"><img src="docs/readme/invest.png" width="250" alt="Sample-data capture of the Invest screen with asset search and stock and crypto shelves"></a><br>
      <strong>Invest</strong><br><sub>Search, stocks, and crypto</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/readme/borrow.png"><img src="docs/readme/borrow.png" width="250" alt="Sample-data capture of the Borrow overview with an open loan and assets available to borrow against"></a><br>
      <strong>Borrow</strong><br><sub>Loans against cb assets</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/readme/activity.png"><img src="docs/readme/activity.png" width="250" alt="Sample-data capture of the Activity ledger with a pending cash-out, an Add money order, and sent and received transfers"></a><br>
      <strong>Activity</strong><br><sub>Transfers, orders, and cash-outs</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/readme/send-review.png"><img src="docs/readme/send-review.png" width="250" alt="Sample-data capture of the Send confirm sheet with amount, sender, recipient, asset, network, and network fee"></a><br>
      <strong>Send review</strong><br><sub>Amount, recipient, and fee</sub>
    </td>
  </tr>
</table>

Capture provenance and regeneration instructions are in [`docs/readme/`](docs/readme/README.md).

## Features

Built on this branch today. Provider integrations still need live, funded confirmation before any real-money use.

**Money in and out**

- Add money through provider adapters for Coinbase Onramp, IDRX (Indonesia), and Ripio (Argentina, Brazil, and Colombia), with quotes, order status, and recovery.
- Cash out through Peer to Cash App or Zelle (US), Monzo or Revolut (UK), and Revolut in the euro area, with one quote showing fees, the amount received, and arrival time.
- Send to any Base address or Basename, with recent recipients and a confirm step that shows the network fee.

**Cash and savings**

- Hold cash in USD, EUR, and IDR stablecoins (USDC, EURC, and IDRX), presented in the currency and formatting of 39 supported countries.
- Earn variable APY in Morpho USDC vaults, with per-position deposit and withdraw trays.

**Invest**

- Discover tokenized stocks and major crypto with market prices, 1D–1Y charts, market stats, and holdings.
- Search Base tokens, then buy and sell them for USDC through one shared, server-prepared swap path. Tokenized stocks are discovery-only for now; server-side eligibility checks are in place ahead of stock trading.

**Borrow**

- Borrow USDC against cbBTC, cbETH, cbXRP, cbDOGE, and cbADA on Morpho markets: capacity, rates, loan health, repay, and collateral management.

**Activity**

- One ledger for transfers, pending actions, funding orders, and cash-outs, with step-by-step status and recovery.

**Operator console** (early)

- An administrator-authorized console at `/admin` whose Settings section edits offered regions and Invest discovery visibility; changes are written to an admin audit log.
- Invite links with first-touch attribution and a Growth summary. The other console sections are empty states for now.

**Design**

- A mobile-first web app with a desktop layout: side navigation, two-column Home, and centered money dialogs.
- App-wide Light, Dark, and System appearance, chosen in Account.
- Tuned motion for sheets, balances, and charts, with reduced-motion support.

**Engineering**

- Server-authored money actions: the server prepares calls, the customer reviews and confirms, and provider and chain data set the status.
- Sign in with email (CDP embedded wallet) or Base Account; network fees can be paid in USDC through a paymaster.
- Layer boundaries, dead code, and design-system rules are enforced in lint and CI, with Playwright and Storybook coverage.

In progress: tokenized stock trading, card programs (provider foundations only), operator fees, applying saved brand settings to customer pages, and the operator support inbox.

## Get started

### Prerequisites

- [Bun](https://bun.sh/) **1.3.12**, pinned by `packageManager`.
- Node.js **22.13 or newer**.

### Install and run

```sh
git clone https://github.com/jessepollak/home.git
cd home
bun install --frozen-lockfile

if [ ! -e apps/web/.env.local ]; then
  cp .env.example apps/web/.env.local
fi

bun dev
```

Open `http://localhost:3000`. Public surfaces work without credentials. The optional pre-release deployment password gate is disabled unless `HOME_ACCESS_REQUIRED=1`; it is not Home customer or administrator authentication. Production rollout and rollback are documented in [Vercel deploy](docs/vercel-deploy.md#pre-release-production-access).

| Sign-in method | Requirements | Guide |
| --- | --- | --- |
| Base Account | `HOME_SESSION_SECRET` (at least 32 characters); no CDP project and no database | [Base Account](docs/base-account.md) |
| Email | Your own CDP project and an allowed local origin | [CDP setup](docs/cdp-setup.md) |

A secret shorter than 32 characters silently disables the Base Account button. Keep secrets server-side and out of Git.

Actions require PostgreSQL through `DATABASE_URL`. The current action contract is [Actions](docs/actions.md) under [Architecture](docs/architecture.md): Home keeps one confirmed action record; the server authors calldata; the client dispatches through CDP or Base; provider and chain data determine status.

For a local database, run `bun run db:up` (Docker), set `DATABASE_URL=postgresql://home:home@127.0.0.1:54320/home_local` in `apps/web/.env.local`, then run `bun run dev`, which applies migrations automatically when `DATABASE_URL` is set.

### Useful commands

```sh
bun test       # deterministic unit and contract tests
bun lint       # Oxlint (native, type-aware, and Home contract rules)
bun typecheck  # generated route types and strict TypeScript
bun build      # production build
bun check      # repository gates, test, lint, typecheck, and build
```

## Customize it

| Customize | Start here |
| --- | --- |
| Brand, colors, and navigation | `apps/web/config/brand.ts`, `apps/web/app/globals.css`, `apps/web/config/navigation.ts` |
| Countries and currency presentation | `apps/web/config/regions.ts`; administrators choose offered regions in `/admin` Settings |
| Wallet, savings, and Invest assets | `apps/web/config/portfolio-assets.ts`, `apps/web/shared/savings/config.ts`, `apps/web/config/invest-assets.ts`; administrators hide Invest categories and assets in `/admin` Settings |
| Account, data, funding, and protocol providers | `apps/web/server/` and the matching setup guides in `docs/` |

Operator settings need PostgreSQL (`DATABASE_URL`) and an administrator allowlist; see [Fork and extend](docs/fork-and-extend.md), and read it before publishing a customized deployment. Country selection changes presentation and formatting; it does not grant eligibility.

## Repository map

| Place | Purpose |
| --- | --- |
| `apps/web/app/` | Next.js routes, metadata, and global styles |
| `apps/web/client/` | Product experiences, client state, and flows |
| `apps/web/shared/` | Contracts, validation, math, formatting, and presenters |
| `apps/web/server/` | Authenticated provider, protocol, persistence, and action boundaries |
| `apps/web/config/` | Brand, region, navigation, asset, and presentation configuration |
| `docs/` | Setup, product, architecture, and extension guides |

## Contributing

Focused upstream changes are welcome. Read [CONTRIBUTING](CONTRIBUTING.md), keep credentials and funded-wallet secrets out of Git, and run `bun check` before opening a pull request.

## Security

Report suspected vulnerabilities privately through the repository [security policy](SECURITY.md), not through a public issue.

## License

Original repository content is licensed under [MIT](LICENSE). Third-party materials, provider SDKs, fonts, and trademarks keep their own terms.

The Home mark's font provenance and reuse constraints are documented in [`apps/web/public/home-mark/PROVENANCE.md`](apps/web/public/home-mark/PROVENANCE.md). Do not assume the Home mark, its fonts, or Base-related marks are covered by the MIT license.
