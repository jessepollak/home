# README product captures

The root README uses five real browser captures of the current Home implementation:

- [`home.png`](home.png) — signed-in Home dashboard;
- [`save.png`](save.png) — the current Save experience;
- [`invest.png`](invest.png) — Invest discovery;
- [`send.png`](send.png) — the Send amount sheet;
- [`borrow.png`](borrow.png) — the currently supported Borrow market.

All five images are **sample-data captures**, not live account records or evidence of production availability. They were rendered at a 390 × 844 CSS-pixel viewport with Chromium at 2× device scale, producing compact 780 × 1688 PNG files.

## Provenance and safety boundary

[`capture.ts`](capture.ts) renders the actual application code without changing the UI. It starts from the same `HOME_PLAYWRIGHT_SMOKE=1` sample account-provider boundary used by `apps/web/playwright.config.ts` and `apps/web/tests/browser/smoke.pw.ts`, then intercepts every `/api/**` request with local sample responses.

The capture process:

- does not read or copy `.env.local`;
- does not require provider credentials;
- does not contact external API, RPC, wallet, or funding providers;
- does not use a real account, wallet, customer record, or funds;
- does not sign, dispatch, submit, or confirm a transaction.

The balances, prices, rates, positions, addresses, and timestamps in the images are illustrative fixture data. Rates are variable examples, not promised returns.

## Regenerate

Install the pinned workspace dependencies first:

```sh
bun install --frozen-lockfile
```

In one terminal, run the web app on the smoke-fixture boundary. Port `3199` matches the existing Playwright configuration; use another local port if it is occupied.

```sh
HOME_PLAYWRIGHT_SMOKE=1 bun --cwd apps/web dev -- --port 3199
```

In a second terminal, capture the screens:

```sh
NODE_PATH="$PWD/apps/web/node_modules" \
HOME_CAPTURE_BASE_URL=http://localhost:3199 \
bun docs/readme/capture.ts
```

Visually inspect every image after regeneration. Captures should show the settled screen with no loading state, stale error, or provider request. Keep the current in-app labels in the images—most notably, the product screen remains **Save** even though the README's future-facing vision uses **Earn**.
