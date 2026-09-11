# README UI mockups

These authored SVG sheets illustrate the current Home interface for the repository README:

- [`overview.svg`](overview.svg) — Home, Save, and Invest mobile views.
- [`flows.svg`](flows.svg) — Send, Activity, and the bounded USDC-against-cbBTC Borrow view.

The artwork is source-grounded in `apps/web/app/home-experience.tsx`, `apps/web/app/globals.css`, `apps/web/config/navigation.ts`, `apps/web/features/savings/savings-experience.tsx`, `apps/web/features/invest/invest-hub.tsx`, `apps/web/features/invest/asset-detail-screen.tsx`, `apps/web/features/transfers/transfer-actions.tsx`, `apps/web/features/transfers/send-dialog.tsx`, `apps/web/features/money-modal/money-modal.tsx`, `apps/web/features/activity/activity-panel.tsx`, and `apps/web/features/borrowing/borrowing-experience.tsx`, together with their local CSS modules and current asset configuration.

All balances, prices, dates, addresses, yields, market readings, and transaction details are illustrative. Home, Save, and Send share illustrative balances; Borrow uses a separate position example. Sample APYs are variable examples, not promised or guaranteed returns. The sheets are documentation artwork, not screenshots or implementation proof. No live accounts, wallets, providers, RPC endpoints, or funded flows were exercised to create or validate them.

The SVG files are self-contained, use system fonts, contain no scripts, external dependencies, embedded raster images, or `foreignObject` content, and are covered by the repository's MIT license.
