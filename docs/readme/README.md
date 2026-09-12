# README product captures

The capture set contains five full-size browser screenshots of the current Home implementation:

- [`home.png`](home.png) — signed-in Home dashboard;
- [`save.png`](save.png) — the current Save experience;
- [`invest.png`](invest.png) — Invest discovery;
- [`send.png`](send.png) — the Send amount sheet;
- [`borrow.png`](borrow.png) — the currently supported Borrow market, linked from the root README's current-availability section.

The root README's inline gallery features Home, Save, Invest, and Send. All captures use sample data; they are not live account records or evidence of production availability. They were rendered at a 390 × 844 CSS-pixel viewport with Chromium at 2× device scale, producing 780 × 1688 PNG files.

## Provenance and safety boundary

[`capture.ts`](capture.ts) renders the actual application code on the same `HOME_PLAYWRIGHT_SMOKE=1` sample account-provider boundary used by `apps/web/playwright.config.ts` and `apps/web/tests/browser/smoke.pw.ts`. Browser requests to the known local `/api/**` routes are fulfilled with fixed samples, and the exact public Basename resolver request made by `ProfileMark` is fulfilled locally with an empty profile. The browser context blocks service workers, aborts unexpected non-local requests, and fails the capture if one is observed. Unknown local API routes are also aborted and reported rather than reaching the development server.

The browser fixture process does not require provider credentials and does not send real API, auth, wallet, funding, or transaction requests. It does not sign, dispatch, submit, or confirm a transaction. The balances, prices, rates, positions, addresses, and timestamps in the images are illustrative fixture data. Rates are variable examples, not promised returns.

Next.js development mode loads local `.env*` files when they exist. Regenerate only in a disposable clean worktree that contains no `.env*` files other than tracked `.env.example`, and launch both processes with a cleared environment so real secrets are not inherited. The capture script checks filenames in the repository root and `apps/web` and refuses to run when it finds another `.env*` file; it never reads environment-file contents. This filename check and browser routing do not inspect or make claims about an already-running server, so start the server exactly as shown below.

The capture suppresses only the `nextjs-portal` development badge before taking each screenshot and moves the pointer outside the viewport. It does not hide or alter product UI; preserve current in-app labels, including **Save**.

## Regenerate

Create a disposable worktree from the commit being documented, then confirm it is clean before installing pinned dependencies. Do not copy any `.env.local` into it.

```sh
git worktree add /tmp/home-readme-capture HEAD
cd /tmp/home-readme-capture
find . -path './.git' -prune -o -name '.env*' ! -name '.env.example' -print
bun install --frozen-lockfile
```

The `find` command must print nothing. In one terminal, run the web app on the smoke-fixture boundary. Port `3199` matches the existing Playwright configuration.

```sh
env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  NEXT_TELEMETRY_DISABLED=1 \
  HOME_PLAYWRIGHT_SMOKE=1 \
  bun --cwd apps/web dev -- --port 3199
```

In a second terminal, capture the screens with the workspace's pinned Playwright dependency:

```sh
env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  NODE_PATH="$PWD/apps/web/node_modules" \
  HOME_CAPTURE_BASE_URL=http://localhost:3199 \
  bun docs/readme/capture.ts
```

Visually inspect all five images after regeneration. Captures should show settled screens with no loading state, stale error, developer badge, or hovered row. The script's successful exit confirms that it observed no unexpected browser request during that run.
