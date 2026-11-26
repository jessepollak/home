# README product captures

> [!IMPORTANT]
> This is a specialized documentation asset generator for the root README. It does not replace the required `agent-browser` before/after iteration in [Browser validation](../browser-validation.md), committed Playwright regression coverage selected by that contract, or current-head PR preview proof.

The capture set contains one short sample-data clip and nine full-size mobile browser screenshots of the current Home implementation.

[`demo.gif`](demo.gif) is a looping clip of about 17 seconds at 390 × 844: Home, then Cash with the Add money sheet, Invest, the Bitcoin asset detail, and the Send flow ending on the confirm sheet. It stops on the review; nothing is sent. [`clip.ts`](clip.ts) records it.

The screenshots, in the order [`capture.ts`](capture.ts) takes them:

- [`home.png`](home.png) — signed-in Home dashboard with total balance, Add money, Cash out, and Send, Your money, and Activity;
- [`cash.png`](cash.png) — Cash, with Add money and Convert, stablecoin currencies, and savings;
- [`savings.png`](savings.png) — the per-position management tray opened from Cash → Savings;
- [`invest.png`](invest.png) — Invest discovery with stock and crypto shelves and the search button;
- [`asset.png`](asset.png) — the Bitcoin asset detail, opened from Invest, with its price chart, price source, holding, and stats;
- [`activity.png`](activity.png) — the Activity ledger with a pending cash-out, an Add money order, and transfers;
- [`borrow.png`](borrow.png) — the Borrow overview with an open loan and assets to borrow against;
- [`send-review.png`](send-review.png) — the Send confirm sheet with amount, recipient, and network fee, captured before anything is signed;
- [`home-dark.png`](home-dark.png) — Home with the Account appearance preference set to Dark.

The root README's gallery opens with the clip and shows all nine screenshots, led by Home. All captures use sample data; they are not live account records or evidence of production availability. They were rendered at a 390 × 844 CSS-pixel viewport with Chromium at 2× device scale, producing 780 × 1688 PNG files; the clip is recorded at the same viewport and encoded as a 390 × 844, 15 fps GIF, because Playwright video records CSS pixels. `clip.ts` cuts the moment between tapping Bitcoin and its price chart being drawn, and fails when the GIF exceeds 4 MB. The set is mobile-only; the desktop layout is not captured.

## Provenance and safety boundary

Both scripts open their browser through [`sample.ts`](sample.ts), which holds the shared sample data, routing, and checks below. It renders the actual application code on the same `HOME_PLAYWRIGHT_SMOKE=1` sample account-provider boundary used by `apps/web/playwright.config.ts` and `apps/web/tests/browser/fixtures/api.ts`, and reuses that suite's session, actions, funding-provider, Borrow, trade-availability, and cash-out sample bodies. Add money lists a sample US Coinbase binding so the sheet shows a deposit method; no funding quote or order route is fulfilled. Browser requests to the known local `/api/**` routes are fulfilled with fixed samples, and the exact public Basename resolver request made by `ProfileMark` is fulfilled locally with an empty profile. The Vercel Speed Insights loader script is aborted and counted, so no analytics request leaves the browser. The browser context blocks service workers, aborts other unexpected non-local requests, and fails the capture if one is observed. Unknown local API routes are also aborted and reported rather than reaching the development server. A client error report fails the run, except the browser's benign ResizeObserver loop notice.

The Send review is reached through a locally fulfilled `POST /api/actions/prepare`; neither script presses the final Send button. Any non-GET request to an action's `confirm`, `handle`, `decline`, `retry`, or `paymaster` route, to `/api/funding/orders`, or to `/api/trades` is aborted and fails the capture.

The browser fixture process does not require provider credentials and does not send real API, auth, wallet, funding, or transaction requests. It does not sign, dispatch, submit, or confirm a transaction. The balances, prices, rates, positions, addresses, and timestamps in the images are illustrative fixture data. Rates are variable examples, not promised returns.

Next.js development mode loads local `.env*` files when they exist. Regenerate only in a disposable clean worktree that contains no `.env*` files other than tracked `.env.example`, and launch both processes with a cleared environment so real secrets are not inherited. Both scripts check filenames in the repository root and `apps/web` and refuse to run when they find another `.env*` file; it never reads environment-file contents. This filename check and browser routing do not inspect or make claims about an already-running server, so start the server exactly as shown below.

The scripts suppress only the `nextjs-portal` development badge and move the pointer outside the viewport. The clip starts signed in through the smoke fixture's session flag rather than recording the sign-in sheet. It does not hide or alter product UI; preserve current in-app labels, including **Cash**.

## Regenerate

Create a disposable worktree from the commit being documented, then confirm it is clean before installing pinned dependencies. Do not copy any `.env.local` into it.

```sh
git worktree add /tmp/home-readme-capture HEAD
cd /tmp/home-readme-capture
find . -path './.git' -prune -o -name '.env*' ! -name '.env.example' -print
bun install --frozen-lockfile
```

The `find` command must print nothing. In one terminal, run the web app on the smoke-fixture boundary. `HOME_FIXTURE_PORT` defaults to `3199` for that fixture server; export it to pin both the server and Playwright to the same port, or a different port on a dedicated runner slot.

```sh
env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  HOME_FIXTURE_PORT="${HOME_FIXTURE_PORT:-3199}" \
  NEXT_TELEMETRY_DISABLED=1 \
  HOME_PLAYWRIGHT_SMOKE=1 \
  bun --cwd apps/web dev -- --port "${HOME_FIXTURE_PORT:-3199}"
```

In a second terminal, capture the screens with the workspace's pinned Playwright dependency:

```sh
env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  HOME_FIXTURE_PORT="${HOME_FIXTURE_PORT:-3199}" \
  NODE_PATH="$PWD/apps/web/node_modules" \
  bun docs/readme/capture.ts
```

Record the clip in the same second terminal. It needs `ffmpeg` on `PATH` to trim the Playwright video and encode the GIF:

```sh
env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  HOME_FIXTURE_PORT="${HOME_FIXTURE_PORT:-3199}" \
  NODE_PATH="$PWD/apps/web/node_modules" \
  bun docs/readme/clip.ts
```

Visually inspect all nine images and step through the clip after regeneration. Captures should show settled screens with no loading state, stale error, developer badge, or hovered row, and sample values that read as plausible amounts. Each script's successful exit confirms that it observed no unexpected browser request during that run. Sample timestamps are relative to the capture time, so dates in the images change on each run.

The script writes into the disposable worktree's `docs/readme/`. Copy the PNG files and `demo.gif` back into your working branch, and delete any capture the root README no longer uses. Then remove the worktree from your working checkout. The regenerated images leave it dirty, so removal needs `--force`, which discards anything not yet copied back:

```sh
git worktree remove --force /tmp/home-readme-capture
```

The operator console at `/admin` is not captured. It needs a signed administrator session and PostgreSQL-backed settings, which are outside this credential-free fixture boundary.
