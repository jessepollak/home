# Changelog

What changes for operators in each Home release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the [release policy](docs/releases.md).

## [v0.1.0] — unreleased

The first tagged release. Home is under active development: it is not production-authorized, and every provider integration still needs live, funded confirmation before real-money use.

### Customer app

- Sign in with email (a CDP embedded wallet) or Base Account.
- Add money through Coinbase Onramp, IDRX (Indonesia), and Ripio (Argentina, Brazil, and Colombia), with quotes, order status, and recovery.
- Cash out through Peer to Cash App or Zelle (US), Monzo or Revolut (UK), and Revolut in the euro area, with one quote showing fees, amount received, and arrival time.
- Send to any Base address or Basename, with recent recipients and a review step that shows the network fee.
- Hold USD, EUR, and IDR stablecoins (USDC, EURC, and IDRX), shown in the currency and formatting of 39 supported countries.
- Earn variable APY in Morpho USDC savings vaults, with deposit and withdraw per position.
- Browse tokenized stocks and major crypto with prices, charts, and stats; buy and sell Base tokens for USDC. Stocks are discovery-only.
- Borrow USDC against cbBTC, cbETH, cbXRP, cbDOGE, and cbADA on Morpho markets, with loan health, repay, and collateral management.
- See transfers, pending actions, funding orders, and cash-outs in one Activity ledger with step-by-step status.
- Pay network fees in USDC instead of ETH.
- Export account data, or leave Home and delete Home-held account records.
- Use it on mobile or desktop, in Light, Dark, or System appearance.

### Operator console

- `/admin` is open only to the administrator addresses you list in `HOME_OPERATOR_ADDRESSES`.
- First-run Setup checks the session secret, administrator list, and database, and shows which optional providers are configured.
- Running version shows the deployed commit and deployment ID.
- Settings choose offered regions, products, funding corridors, fees, and which Invest categories and assets appear. Every change is written to an audit log.
- Invite links record first-touch attribution, summarized on a Growth page.

### Branding

- Set your app's name, description, primary color, and background color in Admin → Settings → Brand, with no code change.
- Deeper changes to logo, navigation, and theme are code defaults in your fork ([fork and extend](docs/fork-and-extend.md)).

### Providers and hosting

- Deploys to Vercel with PostgreSQL; the [deploy guide](docs/vercel-deploy.md) covers launch, update, backup, and recovery.
- Deeper changes to navigation, theme, and default assets are code defaults in your fork ([fork and extend](docs/fork-and-extend.md)).

### Not yet included

- Tokenized stock trading, card programs, operator fee collection reporting, and the operator support inbox are in progress and not part of this release.

## Upgrading

Moving between tags is a merge of upstream Home into your fork. Follow [Update, backup and recovery](docs/vercel-deploy.md#update-backup-and-recovery) every time: back up and rehearse the restore first. Between versions:

- Tokenized stock trading, card programs, operator fees, and the operator support inbox are in progress and not part of this release.
- **New environment variables appear in `.env.example`.** Compare it with the previous tag and set any new variable in Vercel before you deploy. A release entry names any variable you must set.
- **Settings rows survive.** Operator settings live in your database and carry over. When a release changes a settings format, it upgrades your saved values on read; older releases cannot read a newer format, so check the rollback rules before rolling back.

[v0.1.0]: https://github.com/jessepollak/home/releases/tag/v0.1.0
