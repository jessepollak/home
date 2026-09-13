# UI direction audit — 2026-09-12

Scope: rendered copy and structure in `apps/web/client` product surfaces. Accessibility text and actionable review facts are excluded.

## Findings

- `apps/web/client/borrowing/borrowing-experience.tsx:187` — decorative `Borrow` kicker repeats the clear `USDC against cbBTC` heading.
- `apps/web/client/savings/savings-experience.tsx:351,359` — styled `Vault` overlines add a redundant label above the vault list.
- `apps/web/client/account/account-screen.tsx:462,475` and `apps/web/client/home/shell-panels.tsx:98` — “account/private details remain hidden” is generic reassurance beneath actionable account-check errors.
- `apps/web/client/funding/add-money-dialog.tsx:201,309-312` — “Use Coinbase to deposit USD” repeats the `Deposit USD` choice, and the hosted-onramp sentence repeats the heading and Continue button.
- `apps/web/client/trading/trade-actions.tsx:73-78,469` — stock issuer/provider eligibility explanations are compliance copy on Invest; the unavailable state should be short and the reason canonicalized in Account.
- `apps/web/client/borrowing/borrowing-experience.tsx:190-216` — the provider badge, “One verified market,” and full Morpho/token/oracle contract roster are provider and contract disclosures on Borrow.
- `apps/web/client/borrowing/borrowing-experience.tsx:228,241-243,257,261,263,270,422` — Base RPC/pinned-block source footnotes, “not a promise/safety guarantee,” and “Destination: verified wallet” are source/disclaimer or redundant reassurance copy rather than action controls.
- `apps/web/client/funding/order-flow.tsx:131` — provider terms are linked inside the funding product flow instead of Account → Disclosures / Terms.
- `apps/web/client/funding/order-flow.tsx:147` — “These details came from [provider]” is a provider-source footnote on a review screen; the amount and fees already provide the actionable review facts.
- `apps/web/client/landing/supported-globe.tsx:387,390-392` — “Illustrative connections,” product-availability, and “not transactions/live activity/verified corridors” are catalog/disclosure footnotes on Home.
- `apps/web/client/activity/activity.module.css:17-24`, `apps/web/client/borrowing/borrowing-experience.module.css:49-53`, `apps/web/client/savings/savings-experience.module.css:90-97`, and `apps/web/client/landing/supported-globe.module.css:180-186` — kicker/caption rules are orphaned already or become orphaned when the elements above are removed.
