# Home feature map

This is the enumerated map of every user-reachable surface in `apps/web`, written for agents that
drive the app with the repository-pinned `agent-browser` (see
`.agents/skills/browser-iteration/SKILL.md`, normalized by `docs/browser-validation.md`). Read it
before starting a browser session: pick the **surface id** you are changing, follow its **Reach**
steps from a fresh fixture session, assert the **Expect** facts, exercise every listed **State** you
touched, and capture the listed **Evidence** (screenshot, DOM text snapshot, console/errors, perf
marks by name). Selectors are quoted from the file that defines them; anything not confirmed in code
is in **Unknowns** — never invent a selector when Reach is ambiguous, snapshot first.

**Keeping this current:** run a `chore(dx)` pass whenever `apps/web/app/**/page.tsx`, `apps/web/client/*/*-experience.tsx`, or
`apps/web/tests/browser/*.pw.ts` changes. State that bracket in the PR body; do not silently drift this map.
The CI Playwright replay in `apps/web/tests/browser/feature-map-replay.pw.ts` parses this map
through `apps/web/tests/browser/feature-map/map.ts` and executes every non-manual fixture Reach. Keep its explicit skip
reasons aligned with the map when changing a Reach or fixture. Reach guides the agent; it never
authorizes a money click. Full-text snapshots reveal facts hidden by interactive-only snapshots; number-flow amounts appear as images (for example `image "$1.00"`), not text;
scope huge trees (notably coverage's globe), and prefer current `@refs` when names churn. Do not use `wait --text` on accessible-name-only labels: `Borrow markets` names a list, not visible text. A live Reach ends at review; its separate marked confirm requires the ladder's Rung 3 or Jesse's direct authorization, a fresh `live-login` and the shared confirm lock. `HOME_VERIFY_ACCOUNT_ADDRESS` (the bot account's full 0x wallet address) is the trusted anchor. On Rung 2 up-to-review walks of a prepared wallet action and before each marked click, read the review `From` row's full address from the copy control's title or `Full address …` fallback and run `bun run --silent --cwd apps/web live-login --check-account <address>`. It compares case-insensitively against the environment or private file without printing the anchor; stop on nonzero exit. The short address alone is insufficient. If the anchor is absent on a Rung 2 walk (no click), Account settings' full address can serve only as a consistency check; evidence must say the anchor was not provisioned and bot identity was not established. Before a marked click the anchor is required: if missing, do not press the control and report `Real money: not tested`, naming `HOME_VERIFY_ACCOUNT_ADDRESS`. The row identifies the prepared action's executing account; only the provisioned anchor establishes it is the bot account. Provider funding (`add-money`) reviews carry no prepared action, `From` row or marked control; its Rung 2 walk reads the quote facts and stops before the provider hand-off.

Fixture baseline referenced throughout: `HOME_PLAYWRIGHT_SMOKE=1`, rootless
`bun --cwd apps/web dev -- --port "${HOME_FIXTURE_PORT:-3199}"` ([browser validation](../../../docs/browser-validation.md#fixture-session-on-port-3199)).
`fixture-session` seeds `sessionStorage["home:playwright-smoke:signed-in"]="1"` before navigation
and installs the [shared fixture routes](../../../apps/web/tests/browser/feature-map/fixtures.ts).
The Playwright replay uses `tests/browser/fixtures/api.ts` and the same static recipient routes.
Fixtures are session-local; balances snapshots come from `tests/browser/fixtures/balances.ts`.

## Surface index

| id | family | route | auth state | fixture state needed | entry trigger |
|---|---|---|---|---|---|
| `landing` | home | `/` | anonymous (signed-in 307 → `/home`, app/page.tsx) | none (`SupportedGlobeDynamic`) | goto `/` |
| `sign-in` | account | `/?account=signin`, `/account` (redirect) | anonymous | `installApiFixtures` (session/OTP fixture) | header `Sign in` (shell-chrome.tsx) or goto `/?account=signin` |
| `home-panel` | home | `/home` | signed-in recommended; signed-out redirects to `/?account=signin` | signed-in seed + `/api/session`, `/api/balances` fixtures | the `.` landing `Open dashboard`/post-OTP `router.replace("/home")` (shell.tsx) |
| `balances` | home/balances | `/balances`, `/balances/cash`, `/balances/investments` | same as home-panel | signed-in seed + balances fixture; `scrollableBalancesSnapshot()` for reveal/scroll | goto path (Home no longer links here since #789; #686 owns the shell collapse) |
| `activity` | activity | `/activity` | same | signed-in seed + `/api/activity`, `/api/actions` fixtures | goto path (Home renders the same feed inline since #789) |
| `save` | savings | `/save`, `?flow=save-deposit`, `?flow=save-withdraw` | same | `HOME_PLAYWRIGHT_SMOKE=1`; `/api/savings/vaults` fixture present in tests/browser/fixtures/api.ts `installApiFixtures` | Home `Your money` Cash row (home-overview.tsx), goto `/save?flow=save-deposit` |
| `borrow` | borrowing | `/borrow`, `/borrow/<marketId>` | same | session + borrow market fixtures | Home `Your money` Borrow Cash row (home-overview.tsx), goto path |
| `invest` | invest | `/invest`, `/invest/stocks|crypto|memes`, `/invest/<assetId>` | same | session + `/api/invest/discover`, `/api/market-prices` fixtures | Main navigation `Invest` button (primary-navigation.tsx), goto path |
| `send` (money modal) | transfers/money-modal | overlay on any shell route: `?flow=send` | signed-in (button disabled pre-boundary, transfer-actions.tsx) | signed-in seed + `/api/actions/prepare`, `[id]` pending-review, `/api/transfers/recipient-name`, `/api/transfers/recent-recipients` fixtures (confirmation is not part of routine verification) | `Send` button, `data-action-trigger` (transfer-actions.tsx) |
| `add-money` (funding) | funding | overlay on any shell route: `?flow=add-money` or `?flow=receive`; `/fund` redirects to `/home?add-money=1` (app/fund/page.tsx) | signed-in for methods; signed-out shows `Sign in` link (add-money-dialog.tsx) | provider fixture (`/api/funding/providers`); IDRX path in funding.pw.ts | `Add money` button (funding-actions.tsx); with no local onramp, Receive crypto remains and a country-specific deposit status appears after providers load |
| `cash-out` (Peer offramp) | transfers/funding | inner steps of `send`: payout/handle/handle-confirm | signed-in, region with offramp provider | PEER_OFFRAMP stub and `openPeerCashOutHandle` in mobile-geometry.pw.ts | `Send` → amount → `Continue` → `Send to Cash App or Zelle` (US; send-dialog.tsx `CashoutItem`). Where no offramp binding exists, the destination step shows the country's unavailable status. |
| `account-settings` | account | `/?account=settings` (dashboards commit `?account=settings`, shell.tsx `openAccountSettings`) | signed-in verified | signed-in seed | header profile mark (`ProfileMark`, shell-chrome.tsx) → settings; or goto `/home?account=settings` |
| `access-gate` | access | `/access?next=%2Fhome` | anonymous (deployment gate; env-driven, app/access/page.tsx) | `HOME_ACCESS_PASSWORD` env (tests/browser/access.pw.ts) | protected request redirects to `/access` |
| `coverage` | coverage | `/coverage` | public | none | goto `/coverage` (also `/coverage.csv`) |
| `dev-ui` | coverage/dev | `/dev/ui` | public only when `HOME_PLAYWRIGHT_SMOKE=1` or dev (app/dev/ui/page.tsx) | `HOME_PLAYWRIGHT_SMOKE=1` | goto `/dev/ui` |
| `toasts` | home | any dashboard route after action | signed-in | action fixture (tests/browser/fixtures/api.ts; send.pw.ts) | action completion (action-toasts.tsx) |

API routes (no UI; listed for request-level assertions): `app/api/{access,access/logout,session,balances,activity,client-errors,client-performance,actions,actions/prepare,actions/[id],actions/[id]/confirm,actions/[id]/handle,auth/base/{nonce,verify,logout},borrow,borrow/markets/[marketId],funding/{providers,quotes,orders,orders/[id],offramp/orders,provider-customers,provider-customers/verification,webhooks/[provider]},invest/discover,market-prices,market-prices/history,savings/vaults,trades,transfers/{recipient-name,recent-recipients},webhooks/cdp}`. `/api/actions/*`, `/api/activity`, `/api/balances`, `/api/borrow`, `/api/borrow/markets/[marketId]`, and `/api/transfers/*` require `authorizeSession`; provider and public route authorization remains route-specific.

## Live hosts

Hosts Home is known to call from the browser on a deployed environment. These are
observations for reviewing browser requests, not automatic permission to widen origins.

- `media.thegrid.id`, `token-media.defined.fi` — token artwork returned by the Codex token-image lookup (`apps/web/server/market-data/codex/token-images.ts:68`) and rendered by asset marks such as the borrow market header (`apps/web/client/borrowing/borrowing-experience.tsx:440`) and the invest list; both observed in the first provisioned live canary on 2026-09-22.
- `api.ensideas.com` — Basename profile lookup (`apps/web/client/account/basename-profile.ts:9`); observed in the first production run on 2026-09-21.
- `api.cdp.coinbase.com` — CDP browser session and Coinbase onramp API (`apps/web/server/funding/providers/coinbase/manifest.ts:5`).
- `secure-wallet.cdp.coinbase.com` — CDP embedded-wallet origin.
- `pay.coinbase.com` — Coinbase onramp embed and redirect (`apps/web/server/funding/providers/coinbase/manifest.ts:6`; rendered by `apps/web/client/funding/order-flow.tsx:685`).
- `checkout.idrx.co` — IDRX checkout redirect (`apps/web/server/funding/providers/idrx/manifest.ts:6`).
- `skala.ripio.com` — Ripio onramp API and payment redirect (`apps/web/server/funding/providers/ripio/manifest.ts:5`).
- `kyc.ripio.com` — Ripio customer KYC handoff (`apps/web/server/funding/providers/ripio/manifest.ts:6`).

Recipient-name resolution is server-side (`apps/web/server/transfers/recipient-resolver.ts`), so the browser still calls only `api.ensideas.com` for names; the resolver origin is not a new browser host.

## Live expected failures

These request failures have been observed on deployments. Inspect browser network results;
do not silently ignore a new failure or treat this list as permission to broaden origins.

- `GET https://api.cdp.coinbase.com/platform/v2/embedded-wallet-api/projects/75f1f0c7-83bf-47c7-a227-e94bb6d04f83/config` 404 — CDP SDK optional project config.

## Surfaces

### `landing`
- **Live**: read-only
- **Owned paths**: `apps/web/app/page.tsx`, `apps/web/client/landing/**`, `apps/web/client/home/shell-chrome.tsx`
- **Reach**:
  1. `goto "/"`
  2. `expect "One home for your money."`
- **Notes**: Optionally use a 900×844 viewport for the pointer-fine layout used by smoke.
- **Expect**: `h1` `One home for your money.` (client/home/shell-chrome.tsx, `landing-title`); subtitle `Invest in any asset, earn more on your savings, and grow your wealth.` (same file); buttons `Sign in` and, when `account.signInAvailability === "ready"`, `Create account` (shell-chrome.tsx); header `Sign in` in `role="banner"` (tests/browser/mobile-geometry.pw.ts "wide touch targets…" test); globe visual `SupportedGlobeDynamic` (app/page.tsx). Signed-in request 307s to `/home` (tests/browser/landing-route.pw.ts).
- **States**: anonymous default; `isVerified` landing variant swaps in `Open dashboard` (shell-chrome.tsx); `sign-out-error` variant shows destructive Alert with `Retry sign out`.
- **Evidence to capture**: screenshot (mobile + desktop); DOM text snapshot; console errors + failed requests (expected none; the globe renderer uses a local dynamic import and makes no application network request); perf marks: `shell:paint` fires here too (client/home/shell.tsx rAF), but `balances:painted`/`session:verified` are dashboard-only.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms.
- **Owned by**: `apps/web/client/landing/`, `apps/web/client/home/shell-chrome.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/app/page.tsx`.
- **Unknowns**: none; `supported-globe.tsx` only dynamically imports the local renderer and does not fetch remote data.

### `sign-in`
- **Live**: read-only
- **Owned paths**: `apps/web/client/account/account-screen.tsx`, `apps/web/client/account/sign-in-*.tsx`, `apps/web/server/auth/**`
- **Reach**:
  1. `goto "/?account=signin"`
  2. `expect "Sign in to Home"`
- **Notes**: The smoke path installs API fixtures, fills `Email address`, presses Enter, fills `Verification code` with `123456`, clicks `Verify and continue`, and expects `/home`.
- **Expect**: dialog labelled `Sign in to Home` (client/account/account-screen.tsx); email + OTP steps; after verify `router.replace("/home")` (shell.tsx `AccountSignInSheet onVerified`). Signed-out visiting `/home`/`/save` lands on `/?account=signin` (one dashboard-route effect; `/save` asserted in routing.pw.ts, `/home` in client/home/home-experience.test.tsx).
- **States**: email step; OTP step; error/execution variants (`That code is not valid. Check the six digits and try again.`, `Try again`, and the resend countdown/`Resend code`); Base-account (CDP) connector variant (sign-in-base-account.tsx) — operator/live path.
- **Evidence**: screenshot of dialog; DOM snapshot; console/errors; marks n/a (`shell:paint` may fire on the root page).
- **Owned by**: `apps/web/client/account/{account-screen,sign-in-email,sign-in-otp,sign-in-shell,sign-in-copy}.tsx`, server `apps/web/server/auth/*` (`authorize.ts`, `render-session.ts`, `native-base-session.ts` per app/layout.tsx).
- **Unknowns**: none; the labels, invalid-code recovery, and resend countdown are defined in `sign-in-email.tsx`, `sign-in-otp.tsx`, and `account-screen.tsx`.

### `home-panel`
- **Live**: read-only
- **Owned paths**: `apps/web/app/home/**`, `apps/web/client/home/home-panel.tsx`, `apps/web/client/home/shell*.tsx`, `apps/web/server/balances/**`
- **Reach**:
  1. `goto "/home"`
  2. `expect "Home"`
  3. `expect "Borrow Cash"`
- **Reach (live)**:
  1. `goto "/home"`
  2. `expect "Total balance"`
  3. `expect "Your money"`
- **Notes**: The fixture-session helper seeds signed-in state and API fixtures. Optionally open `Send` for the money modal or exercise the rows below.
- **Expect**: `Total balance` card with `aria-label="Total balance"` and `aria-busy` while loading (home-overview.tsx) showing the net total from `totals.net`; signed allocation bar (`data-balance-breakdown`, `data-balance-segment="borrow|cash|investments"`, `data-balance-axis` when Borrow is present, components/signed-balance-bar.tsx) with its legend in Borrow, Cash, Investments order; a header status icon button `[data-home-status]` beside the account mark only when a balance read fails or no country is set (home-status.tsx; its accessible name is the message, and tapping it opens `[data-home-status-detail]`, named `Status`, with a `Retry` icon button, or `Open Account` when no country is set); a partial net keeps the dimmed amount marked `[data-total-status]` without a header status; the same header status also reports interrupted live updates on every verified dashboard screen (Home, Invest, nested panels) — `You’re offline. Home will update when you reconnect.` with no action after 2 foreground seconds offline, or `Home can’t refresh right now. Some information may be out of date.` with `Retry` after a failed balances confirmation read — and takes precedence over the Home statuses; money actions group `aria-label="Money actions"` with `Add money` and `Send`; `Your money` card (h2 `your-money-heading`) with exactly three rows — Cash (opens `/save`), Investments (opens `/invest`), Borrow Cash (opens `/borrow`); uncarded Activity feed (h2 `activity-title`, `data-activity-feed`) with a centered spinner (`data-activity-loader`) while older rows load, a centered 44 px `Add money` prompt (`data-activity-nux`) when it is empty, and a centered muted `[data-activity-unavailable]` line with a `Reload activity` icon button when an Activity read fails. The default fixture has no Borrow position, so Borrow Cash renders its no-position context.
- **States** (fixtures): loading → hold `/api/session`/`/api/balances` with `fixtures.delayNextSession()/delayNextBalances()` (balances.pw.ts and save.pw.ts); empty → base fixture minus holdings (**no ready empty fixture exists — construct via `options.balances`**); unavailable → `status: "unavailable"` presentation (home-overview.tsx `Balance unavailable` hero, muted `—` rows without chevrons, header status with `Retry`); offline → `set offline on` for at least 2 s after the dashboard is signed in; interrupted → a balances route returning 5xx on the refresh and on the 5 s confirmation read; error state for action APIs is surfaced in the modal, not the panel.
- **Evidence**: screenshot; DOM text snapshot; console/errors; perf marks `shell:paint`, `session:verified` (shell.tsx:356), `balances:painted` (shell.tsx:402), `action:first-interactive` (client/transfers/transfer-actions.tsx:82). `balances:painted` keeps the smoke suite budget (CI 3,500 / local 1,000 ms); the historical initial budget below does not change smoke.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/home/`, data `apps/web/server/balances/*`, `/api/balances` route.
- **Unknowns**: the Home header status (`[data-home-status]`) appears only on a failed balances read or when no country is set; partial totals alone do not trigger it; Activity failures render inside the feed instead. `statusLabel` feeds the Balances panel and the no-country header status. `MountedShellPanel` sets inactive panels to `hidden`, `inert`, and `aria-hidden`.

### `balances`
- **Live**: read-only
- **Owned paths**: `apps/web/app/balances/**`, `apps/web/client/home/balances-*.tsx`, `apps/web/client/balances/**`, `apps/web/server/balances/**`, `apps/web/app/api/balances/**`
- **Reach**:
  1. `goto "/balances"`
  2. `expect "Your money"`
  3. `expect "Recognized Coin"`
- **Reach (live)**:
  1. `goto "/balances"`
  2. `expect "Your money"`
- **Notes**: The fixture-session helper seeds signed-in state and balances fixture. Use `/balances/investments` with `scrollableBalancesSnapshot()` for anchoring work; the group section is `id="investments"`.
- **Expect**: scroll container `[data-app-main-authenticated]` (shell-panels.tsx); balance rows `[data-balance-list] [data-kind="balance"]` (balances.pw.ts); reveal window grows after scroll (`BALANCES_BATCH_SIZE = 10`, client/home/balances-panel.tsx); `Show small balances` switch lives in account settings, not this page (mobile-geometry.pw.ts touch test).
- **States**: loading shimmer (`BalancesListFallback`, balances-list.tsx); unavailable; empty (`BalancesEmpty`); ready with reveal batches; stale revalidation anchored to requested group (`cold and revalidated cached Balances…` smoke test).
- **Evidence**: screenshot; DOM snapshot; console/errors; perf marks and scroll-offset assertions.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/home/balances-panel.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/client/balances/use-balances.ts`, `/api/balances`.
- **Unknowns**: none; incremental batches use an intersection sentinel rather than a reveal-more button, group anchors come from `/balances/<group>` URLs, and the empty state is `No money yet`.

### `activity`
- **Live**: read-only
- **Owned paths**: `apps/web/app/activity/**`, `apps/web/client/activity/**`, `apps/web/client/home/activity-panel.tsx`, `apps/web/app/api/activity/**`
- **Reach**:
  1. `goto "/activity"`
  2. `expect "Activity"`
- **Notes**: The fixture-session helper seeds signed-in state and API fixtures. Add `/api/activity` fixture rows when exercising populated states; the Home Activity card is the interactive entry point.
- **Expect**: `Activity` heading (`#activity-title`, client/activity/activity-panel.tsx `DefaultActivityHeader`); empty state `No activity yet`; end marker `End of activity`; error `Try again` button; later-page failure shows a concise `Retry`; rows expose `View <direction> <symbol> transaction details` activation labels and brand/curated icons, provider logos, or ≤2-character initials as row marks (activity-panel.tsx `TransferActivityRow`); an indexed Home action retains its action row (title and status) instead of generic transfer rows.
- **States**: loading shimmer (`ActivityPage`, client/home/activity-panel.tsx `ShimmerRows count={4}`); empty (`No activity yet`); error (`Try again`); success list; automatic continuation while the sentinel is visible (client/activity/use-activity.ts: bounded 3-page bursts with a 250 ms yield); later-page failure keeps rows and retries the exact cursor; authoritative exhaustion only at a null cursor; repeated, non-advancing, or cyclic cursors stop without further requests; offscreen, unmounted, or owner-changed continuation stops and fences stale work.
- **Evidence**: screenshot; DOM snapshot; console/errors; marks `shell:paint` (dashboard).
- **Owned by**: `apps/web/client/activity/`, `apps/web/client/home/activity-panel.tsx`, `/api/activity`, `/api/actions`.
- **Unknowns**: row value/date text remains fixture-dependent; pagination has no routine control copy — continuation is automatic while the sentinel is visible, and the only pagination affordances are the later-page `Retry` and the authoritative `End of activity` marker.

### `save`
- **Live**: confirm
- **Owned paths**: `apps/web/app/save/**`, `apps/web/client/savings/**`, `apps/web/shared/savings/**`, `apps/web/app/api/savings/**`, `apps/web/server/savings/**`, `apps/web/server/morpho/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`
- **Confirm labels**: "Deposit $<amount>", "Withdraw $<amount>", "Retry"
- **Reach**:
  1. `goto "/save?flow=save-deposit"`
  2. `expect "Deposit"`
- **Reach (live)**:
  1. `goto "/save?flow=save-deposit"`
  2. `expect "Deposit"`
  3. `click "Decimal point"`
  4. `click "1"`
  5. `click "Continue"`
  6. `expect "Confirm"`
- **Confirm (live, authorization-gated)**: After matching the review `From` row to the account anchor and verifying the other review facts, check `data-money-action-id` on `Deposit $0.10` and, only with Rung 3 or Jesse's direct authorization, click once and expect `Deposited $0.10`. For a funded withdrawal, choose `Withdraw`, use Max for available savings, reach review, then apply the same gate to the marked `Withdraw $<amount>` control.
- **Notes**: On an unfunded Save landing use `Get started` (not `Deposit`); the deep-linked deposit still works. The smoke path dismisses it with Close and browser Back; it also opens Deposit and Withdraw from their buttons, closes via Close or Escape, and asserts focus returns to the exact opener.
- **Expect**: section `role="region"`/`aria-label="Save"` hosted variant (savings-experience.tsx); vault radiogroup `aria-label="Vault"`; `Nothing saved yet` empty; action buttons `Get started` (unfunded) / `Deposit` + `Withdraw` (funded) (savings-experience.tsx); dialog labels from `closeLabel={Close ${mode} dialog}` and `primaryLabel` `Continue` → `Deposit $X`/`Withdraw $X`/`Retry` (savings-actions.tsx lines ~251–350); deposit and withdrawal review rows start with `From` (short address from the prepared action's owner), followed by vault, network, APY, fee, amount, share preview, exchange constraint and validity, then Network fee (when paid in USDC).
- **States**: cold loading (`data-shimmer="savings-hero"`, `savings-apy`); vaults loading `aria-busy`; vaults error `Vaults are temporarily unavailable.` + `Retry`; saved-balance alert `Saved balance stale…`; expired vault rates retain numeric APY without an APY stale notice; deposit/withdraw amount → confirm → pending (`Waiting for your wallet…`) → error/failed.
- **Evidence**: screenshot; DOM snapshot; console/errors; marks `shell:paint`, and `action:first-interactive` when the Send boundary mounts (not Save-specific).
- **Owned by**: `apps/web/client/savings/`, `apps/web/server/actions/*`, `/api/savings/vaults`.
- **Unknowns**: none blocking; notices include `Updating…`, `Loading APY…`, `Loading vaults…`, and the amount dialog reports the formatted available balance.

### `borrow`
- **Live**: confirm
- **Owned paths**: `apps/web/app/borrow/**`, `apps/web/client/borrowing/**`, `apps/web/app/api/borrow/**`, `apps/web/server/borrowing/**`, `apps/web/server/morpho-markets/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`
- **Confirm labels**: "Confirm action", "Retry"
- **Reach**: Seed the signed-in state and borrow fixtures, go to `/borrow` or `/borrow/<marketId>`, then choose a `data-testid="borrow-market-card"` inside the `Borrow markets` list.
- **Reach (live)**:
  1. `goto "/borrow/0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836"`
  2. `expect "Borrow"`
  3. `click "Decimal point"`
  4. `click "1"`
  5. `click "Continue"`
  6. `expect "Confirm"`
- **Reach (live, Repay all up to review)**: Requires a nonzero debt position and wallet USDC; if there is no debt/`Repay` affordance, stop and report the prerequisite, do not manufacture debt. From the market detail, click `Repay`, select `Max` (the amount step shows `Maximum repayment`), click `Continue`, then read the full `Confirm` review. `Max` with insufficient wallet USDC can be a partial repayment; stop unless the review explicitly says `Repay all USDC debt`. Expect `Repay all USDC debt`, Base, and a maximum ≤ borrowed amount + 0.0002 USDC (accrued debt need not equal $0.10).
- **Confirm (live, authorization-gated)**: After matching the review `From` row to the account anchor and verifying the other review facts, check `data-money-action-id` on `Confirm action` and click it once only under Rung 3 or Jesse's direct authorization. Borrow expects `Borrowed $0.10`; repay-all expects `Repaid all Borrow debt` and no remaining debt/Repay affordance. Never reuse a previously stopped prepared action.
- **Verify**: manual
- **Notes**: The shared fixture routes serve `/api/borrow` (overview v2, five registry markets, an open cbETH position) and each `/api/borrow/markets/<id>`; `/api/actions/prepare` is not fixture-backed. Live: the `1` chip renders only when the pinned account holds the market's collateral (`You need <collateral symbol> in this wallet before you can borrow.`). On 2026-09-22 the bot had no cbBTC, so the `1` chip was unavailable. On 2026-09-24 it held cbBTC and reached a $0.10 review; read a fresh position snapshot before acting because collateral and debt change.
- **Expect**: heading `Borrow` (`#borrow-overview-title`, `#borrow-direct-title`, borrowing-experience.tsx); one card per registry market headed by its collateral display name (Bitcoin, XRP, Staked ETH, Dogecoin, Cardano); position actions including `Borrow`, `Add collateral`/`Withdraw collateral from <display name> position` (`aria-label`); `Back to Borrow`; `Market values are unavailable` + `Retry` error; collateral preview `data-testid="borrow-collateral-preview"`; action money modal title `Confirm`, footer `Confirm action`/`Retry`/`Back`/`Close` (borrow-money-dialog.tsx); prepared Borrow, Repay and collateral review rows start with `From` (short address from the prepared action's owner), followed by movement, variable rate, network and Network fee (when paid in USDC).
- **States**: loading/error via `overview.refetch()`/`detail.refetch()` buttons; amount → confirm → pending (`Waiting for your wallet…`, `#borrow-action-pending`) → error/failed.
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/borrowing/`, `apps/web/server/*` borrow modules, `/api/borrow`, `/api/borrow/markets/[marketId]`.
- **Unknowns**: prepare/confirm are not fixture-backed, so review and pending states need unit tests or a live session. Operation labels are `Add collateral`, `Borrow`, `Repay`, `Repay all`, `Withdraw collateral`, and `Close position`.

### `invest`
- **Live**: read-only
- **Owned paths**: `apps/web/app/invest/**`, `apps/web/client/invest/**`, `apps/web/client/trading/**`, `apps/web/app/api/invest/**`, `apps/web/app/api/market-prices/**`
- **Reach**:
  1. `goto "/invest"`
  2. `expect "Invest"`
- **Notes**: The smoke asset-detail path clicks Main navigation `Invest`, clicks the asset row matching `/^NVIDIA/`, expects `/invest/nvdac`, and reads `NVIDIA` from `[data-shell-header-title]`.
- **Expect**: hub shelves `Stocks`, `Crypto`, `Memes` (`discoverShelves`, client/invest/discover.ts; shelf CardTitle `role=heading aria-level=3`, discover-shelf.tsx); `See all ›` per shelf; empty shelf copy `Loading`/`Unavailable`/`None trending` (discover-shelf.tsx `shelfStatusLabel`); category screen `Back to Invest` (category-screen.tsx); asset detail price (`data-tone`), change (`data-money-change`), `Trade <displayName>` group with disabled `Buy`/`Sell` (client/trading/trade-actions.tsx).
- **States**: hub loading/empty/error per shelf (`MemeShelfStatus`); category pagination error `Retry`; detail status screen variant (asset-detail-screen.tsx `AssetDetailStatusScreen`).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/invest/`, `apps/web/client/trading/trade-actions.tsx`, `/api/invest/discover`, `/api/market-prices`, `/api/market-prices/history`.
- **Unknowns**: meme pagination copy remains unknown because no fixture-backed browser state reaches it; category links expose visible `See all ›` text.

### `send` (money modal — steps individually)
- **Live**: confirm
- **Owned paths**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/money-modal/**`, `apps/web/shared/transfers/**`, `apps/web/app/api/actions/**`, `apps/web/app/api/transfers/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`, `apps/web/server/transfers/**`
- **Confirm labels**: "Send $<amount>"
- **Reach** (smoke-verified):
  1. Seed the signed-in fixture and install API fixtures.
  2. `goto "/home"`
  3. `expect "Borrow Cash"`
  4. `click "Send"`
  5. `expect "Send"`
  6. `click "1"`
  7. `click "Continue"`
  8. `expect "Recent recipients"`
  9. `fill "To" "example.base.eth"`
  10. `expect "Resolves to"`
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Send"`
  3. `click "Decimal point"`
  4. `click "1"`
  5. `click "Continue"`
  6. `fill "To" "jesse.base.eth"` (default; a different recipient needs explicit authorization)
  7. `click "Continue"`
  8. `expect "Confirm"`
- **Confirm (live, authorization-gated)**: After matching the reviewed recipient, amount, Base network and the review `From` row against the account anchor, check `data-money-action-id` on `Send $0.10`, then click once only under Rung 3 or Jesse's direct authorization; verify Activity if the success toast is missed.
- **Notes**: The dialog is labelled by `send-title`. Before any live confirm, read the full review and match the `To` address, amount and the `From` row against the approved task and account anchor. Routine UI verification stops before the marked confirm control. Fixture-backed name and recent-recipient behavior is in tests/browser/send-recipients.pw.ts; the fixture-session helper stages static recipient, prepare and pending-review responses through tests/browser/feature-map/fixtures.ts so Send reaches review without a provider or confirmation.
  1. **amount**: type digits via keypad buttons named `0`–`9`, `Decimal point`, `Delete last digit` (`role="group" aria-label="Amount keypad"`, client/money-modal/amount.tsx:581–601); quick chips group `Quick amounts` (`$10`/`$25`/`Max` when priced, amount.tsx:508+). Primary `Continue` disabled until positive amount (`isPositiveDecimalAmount`).
  2. **destination**: step title stays `Send`; field label `To` (AddressField `id="send-recipient"`); primary `Continue` disabled until the typed value is a valid `0x` recipient or a resolved name (send-dialog.tsx `effectiveRecipient`). A `.eth` Basename/ENS value is resolved through `GET /api/transfers/recipient-name?name=…` and shows `Resolves to` with a condensed one-line address under the field; tapping it opens the full address and Copy button in a popover; while it resolves the field is described by `Resolving <name>…`; an unresolved or unsupported value shows an inline `role="alert"`/hint and never enables `Continue`. The account's own recent send recipients render below the `Or` separator under the group label `Recent recipients` (labelled by reverse-resolved name with the truncated address beneath, or the truncated address alone) and selecting one fills `To`.
  3. **confirm**: dialog title becomes `Confirm` (send-dialog.tsx `modalTitle`); summary via `MoneyConfirmSummary` rows `From` (short address from the prepared action's owner), `To` (condensed CopyableValue address; tap for the full address and Copy button), `Asset`, `Network` = `Base`, and `Network fee` when paid in USDC (send-dialog.tsx); primary button `Send $1.00` where amount is `MoneyTicker(confirmAmount)` — smoke clicks `getByRole("button", { name: "Send $1.00" })`; secondary `Back`.
  Every money confirm control (every surface) carries `data-money-action-id=<prepared action id>` (client/money-modal/money-modal.tsx `MoneyConfirmFooter`); no other control does.
  4. **pending**: `Waiting for your wallet…` status, only after the confirm click (send-dialog.tsx); close disabled. While the review is prepared after `Continue`, or an `action` id in the URL is resumed, the Confirm sheet shows `Preparing review…` instead, also with close disabled.
  5. **error**: message + `Try again` (primary) and `Back`; the "ambiguous handle response retries without a second wallet dispatch" test asserts `Try again` then `Send $1.00` again and `sessionStorage["home:playwright-smoke:dispatch-count"] === "1"` (send.pw.ts).
  6. **success/status**: dialog closes; toast `Sent $1.00 to 0x2222…222222` (exact text, send.pw.ts; toast owned by client/home/action-toasts.tsx).
- **Expect**: prepared action via `POST /api/actions/prepare` with a checksummed `0x` `recipient` and, for a name entry, `recipientName` re-resolved server-side (server rejects a name/address mismatch); recent recipients via `GET /api/transfers/recent-recipients` on dialog open, derived from this account's successfully dispatched durable send actions; confirm/handle via `/api/actions/[id]/{confirm,handle}` (smoke fixtures); dialog uses `data-money-sheet` / `data-money-sheet-grabber` (client/money-modal/money-modal.tsx) and reduced-motion transitions are `0s` (send.pw.ts ambiguous-handle retry test).
- **States**: asset picker (`aria-label="Asset"`, amount.tsx:443) with multiple assets; no catalog balance → `No catalog balance is available to send.`; rejected/unknown wallet results via `messageForError` (send-dialog.tsx); destination resolving/resolved/unresolved/unsupported-input states above; recent-recipients list empty (no confirmed sends) or populated; a superseded name resolution must not enable `Continue` (client/transfers/send-dialog-recipients.test.tsx).
- **Evidence**: screenshots per step; DOM snapshot per step (re-snapshot after every material DOM change per SKILL.md); console/errors; startup and first-action marks.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/money-modal/`, `apps/web/shared/transfers/`, `apps/web/server/actions/` (prepare/confirm/handle/list), `apps/web/server/money-actions/`, `apps/web/server/transfers/`, routes `apps/web/app/api/actions/**` and `apps/web/app/api/transfers/**`.
- **Unknowns**: none blocking; exact `MoneyConfirmSummary` fee row for sends (USDC-paymaster sends show the `Network fee` row; native/disabled sends retain wallet fee warning).

### `cash-out` (Peer offramp inner steps)
- **Live**: confirm
- **Owned paths**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/app/api/funding/offramp/**`, `apps/web/server/funding/offramp/**`
- **Confirm labels**: "Cash out $<amount>", "Withdraw $<amount>"
- **Reach** (smoke-verified through re-entry, `openPeerCashOutHandle`, mobile-geometry.pw.ts): 1) seed + `installApiFixtures`. 2) `Send` → digits `1` → `Continue`. 3) click `/Send to Cash App/` (CashoutItem, send-dialog.tsx; the fixture binds only Cash App). 4) click `Cash App` (payment-method button, payout step). 5) textbox `Cash App handle` (label `${selectedPlatform.label} handle`); smoke asserts 16px font and ≥44px portrait target. 6) fill `$alice`, click `Continue` → visible textbox `Re-enter handle`; smoke asserts 16px font and ≥44px portrait target. Input hints (`autocomplete`, `autocapitalize`, `autocorrect`, `spellcheck`, `enterkeyhint`) and `Review` → confirm behavior are asserted in client/transfers/send-dialog.test.tsx, not browser smoke.
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Send"`
  3. `click "Decimal point"`
  4. `click "1"`
  5. `click "Continue"`
  6. `click "Available payout apps: Cash App, Zelle Send to Cash App or Zelle Use Peer to send via app"` (the payout marks contribute their `Available payout apps:` name; the list follows the US corridor order)
  7. `click "Cash App"`
  8. Fill `Cash App handle` with the pinned `HOME_VERIFY_CASHOUT_HANDLE` (never the fixture `$alice`).
  9. `click "Continue"`
  10. Fill `Re-enter handle` with its canonical value (leading `$` stripped, `shared/funding/cash-payee.ts`); stop if it differs. Never send raw handle-step snapshots to logs.
  11. `click "Review"`
  12. Read `Approximate receive` and `Confirm`; compare the payout handle against the pinned value **inside the shell** and redact both forms before any snapshot output.
- **Confirm (live, authorization-gated)**: Check `data-money-action-id` on `Cash out $0.10` and click once only under Rung 3 or Jesse's direct authorization, after review facts and the `From` row match the account anchor.
- **Withdrawal recovery (live, up to review)**: In-flight Peer cash-outs appear on Send's destination step as `Withdraw …` controls. Open the **unique** authorized in-flight order and check its amount, network Base, and the review `From` row against the account anchor. It returns funds to the owner; its withdrawal review has **no payout handle**. No matching in-flight item means stop; do not manufacture one.
- **Recovery confirm (live, authorization-gated)**: Check `data-money-action-id` on `Withdraw $<amount>` and click once only under Rung 3 or Jesse's direct authorization after the order, amount, Base and `From` row checks against the account anchor.
- **Verify**: manual
- **Expect**: modal title `Cash out with Peer` (send-dialog.tsx `modalTitle`); cash-out confirm rows `From` (short address from the prepared action's owner), `Provider`, `Payout app`, `Payout handle`, `Approximate receive`, `Estimated delivery`, `Network` = `Base`; withdrawal confirm omits the payout handle and approximate receive/delivery rows (send-dialog.tsx confirm rows); disclaimer `The fiat amount and delivery time are approximate, not guaranteed.` appears only on the cash-out (deposit) confirm and is omitted from the withdrawal confirm; primary `Cash out $X` or `Withdraw $X`, where the amount is the reviewed USDC amount rendered in dollars (`formatUsdStablecoinAmount`).
- **States**: providers not loaded → CashoutItem and unavailable status absent (requires `PEER_OFFRAMP` stub registered after `installApiFixtures` via `route.fallback`, mobile-geometry.pw.ts); failed read → `Cash out is unavailable right now.` and `Try again` refetches without an empty-corridor flash; loaded empty → `Cash out isn't available in <country> yet.` while ordinary sending remains available; loaded route for a different asset → no cash-out row or unavailable status; recovery items `Withdraw <amount>` for active orders; `Recover a Peer cash-out` button when `recoveryEligible` (send-dialog.tsx).
- **Evidence**: screenshots; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `/api/funding/providers?direction=offramp`, `/api/funding/offramp/orders`.
- **Unknowns**: none blocking; server cashout error copy depends on `serverCashoutMessage` (send-dialog.tsx).

### `add-money` (funding)
- **Live**: up-to-review
- **Owned paths**: `apps/web/client/funding/**`, `apps/web/app/api/funding/**`, `apps/web/server/funding/**`, `apps/web/shared/funding/**`
- **Confirm labels**: "Confirm deposit"
- **Reach** (smoke-verified IDRX path, funding.pw.ts): 1) seed country `ID` (`localStorage["home.country.v1"]="ID"`) + `installApiFixtures`. 2) `signIn(page)` helper. 3) click `Add money` (funding-actions.tsx). 4) method step button `/Deposit IDR/` must contain `IDRX · Bank transfer · Mandiri` (funding.pw.ts). 5) type `20000` via numpad. 6) `Review quote` → heading `Review quote`, row `Receive` contains `20.000,00 IDRX`. 7) `Confirm deposit` → heading `Review payment details`, row `Network` contains `Rp 100,00`. 8) `View payment instructions` → `123456789012` visible; then `Money received` (≤7s budget, funding.pw.ts).
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Add money"`
  3. `expect "Add money"`
  4. `click "Deposit USD Coinbase · Apple Pay"`
  5. `click "2"`
  6. `click "5"`
  7. `click "Review quote"`
  8. `expect "Review quote"`
- **Verify**: manual
- **Rung 2**: read the live `Review quote` card's `Deposit`, `Receive` and fee rows, then stop before `Confirm deposit` hands off to the provider. Provider quotes are not prepared actions, so no `From` row applies.
- **Expect**: dialog titles `Add money` / `Receive` / `Deposit IDR` (add-money-dialog.tsx `title`); multi-method deposit input step has a `Payment method` radiogroup with one checked choice (changing it does not request a quote; `Review quote` does); method list has `Receive crypto` row; close label `Close add money`; receive step QR (`aria-label="QR code for Base address …"`) and address copy (`Copy …`, `Full Base address …`, add-money-dialog.tsx). Signed-out body offers `Sign in` link to `/?account=signin`.
- **States**: method loading (`providerBindingsDisabled={!ordersQuery.isSuccess}`); loaded empty → `No local deposit method in <country> yet.` while `Receive crypto` remains available; `Funding methods are unavailable. Try again.` / `Home couldn't check for an open deposit. Retry.` / `Home couldn't check your provider setup. Retry.` (funding-experience.tsx); quote errors include `Coinbase needs more than $2 after fees. Enter a larger amount.`, `Coinbase couldn't quote this amount. Try a different amount.`, `Quotes are unavailable right now. Try again shortly.`, and `This quote could not be created. Try again.` (order-flow.tsx); resumable open order auto-jumps to `order` step (funding-experience.tsx); customer/KYC step for providers with `customerSetup`.
- **Evidence**: screenshots per step; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/funding/{funding-actions,funding-experience,add-money-dialog,order-flow,receive-qr}.tsx`, `/api/funding/*`.
- **Unknowns**: provider-specific order-flow labels outside the smoke-verified IDRX path remain unknown because they depend on provider configuration; snapshot before acting.

### `account-settings`
- **Live**: read-only
- **Owned paths**: `apps/web/client/account/account-settings.tsx`, `apps/web/client/home/shell-panels.tsx`, `apps/web/client/home/use-show-small-balances.ts`
- **Reach**:
  1. `goto "/home?account=settings"`
  2. `expect "Account"`
- **Notes**: The fixture-session helper seeds signed-in state and fixtures. The Chromium smoke opens the header profile mark with the keyboard, asserts focus enters the settings region, closes through Done and browser Back, restores the exact opener, exercises deep-link and forward-history entry, and verifies every primary-navigation `aria-controls` target remains unique and present. Live: Peer availability varies by deployment and corridor (`PEER_OFFRAMP_ENABLED`, `apps/web/server/funding/providers/peer/manifest.ts`). Production exposed the Cash App path and a live review on 2026-09-24; snapshot current provider availability rather than assuming it is off.
- **Expect**: region `aria-label="Account settings"` receives programmatic focus without selecting an input; `Show small balances` switch (`getByRole("switch", { name: "Show small balances" })`, mobile-geometry.pw.ts; owned by client/home/use-show-small-balances.ts + account-settings region of shell-panels.tsx). Sign-out control and region selector live here (shell-panels.tsx passes `regionId`, `resolutionSource`, `onRegionChange`, `onSignOut` to client/account/account-settings.tsx).
- **States**: preference not ready (`isPreferenceReady`); region override messages (`preferenceMessage`).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/account/account-settings.tsx`, `apps/web/client/home/shell-panels.tsx`.
- **Unknowns**: none; the country selector is described by `Country` / `Sets how money is shown`, and the button is labelled `Sign out`.

### `access-gate`
- **Live**: read-only
- **Owned paths**: `apps/web/app/access/**`, `apps/web/app/api/access/**`, `apps/web/server/access/**`
- **Reach** (smoke-verified): 1) clear cookies; goto `/home` (protected) → redirect `/access?next=%2Fhome`. 2) fill textbox `Access password`; wrong value → `Access denied. Try again.`; cookie `home-access` absent. 3) correct `HOME_ACCESS_PASSWORD` → `Continue` posts `/api/access`, then URL `/home` or `/?account=signin`. 4) heading `Access granted` on revisit; `Leave this deployment` posts `/api/access/logout` (no-JS form also asserted).
- **Verify**: manual
- **Expect**: headings `Enter access password` / `Access granted` (enabled) and `Access unavailable` (misconfigured); `Continue to Home` link after access is granted; CSP header `frame-ancestors 'none'` on the protected response (tests/browser/access.pw.ts); hydrated form marker `form[data-hydrated="true"]`.
- **States**: `misconfigured` → `Access unavailable` heading and `Access is temporarily unavailable.` alert; `disabled` → server redirect to the parsed safe `next` destination (unsafe or missing `next` defaults to `/`) (app/access/page.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/access/page.tsx`, `apps/web/server/access/*`, `/api/access`.
- **Unknowns**: cookie/secret names intentional; do not print credentials.

### `coverage`
- **Live**: read-only
- **Owned paths**: `apps/web/app/coverage/**`, `apps/web/client/coverage/**`, `apps/web/config/coverage.ts`, `apps/web/components/ui/coverage-table.tsx`
- **Reach**:
  1. `goto "/coverage"`
  2. `expect "Local money coverage"`
- **Notes**: Exercise the Search textbox and the four comboboxes `1:1 onramp`, `Portfolio`, `Integrated`, `Sort`, plus the `sort` query parameter when validating filters.
- **Expect**: `Local money coverage | Home` title; coverage table rows (components/ui/coverage-table.tsx); combobox font ≥16px on mobile/landscape (tests/browser/mobile-geometry.pw.ts).
- **States**: filtered-empty result reports `Showing 0 of <total> countries and territories.` and an empty coverage table.
- **Evidence**: screenshot (390×844 and 844×390); DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/coverage/page.tsx`, `apps/web/client/coverage/`, `apps/web/config/coverage.ts`.
- **Unknowns**: none; filters are `Search`, `1:1 onramp`, `Portfolio`, `Integrated`, and `Sort`.

### `dev-ui`
- **Live**: read-only
- **Owned paths**: `apps/web/app/dev/ui/**`, `apps/web/components/ui/**`
- **Reach**: Run with `HOME_PLAYWRIGHT_SMOKE=1` or in development, go to `/dev/ui`, and otherwise expect `notFound()` (404).
- **Verify**: manual
- **Expect**: `Home UI theme` heading; swatch grid; `Stock type scale` card; `Buttons` section with `Primary`/`Outline`/`Destructive` (app/dev/ui/page.tsx).
- **States**: enabled vs 404.
- **Evidence**: screenshot; DOM snapshot.
- **Owned by**: `apps/web/app/dev/ui/page.tsx`.
- **Unknowns**: none.

### `toasts`
- **Live**: read-only
- **Owned paths**: `apps/web/client/home/action-toasts.tsx`, `apps/web/server/actions/**`, `apps/web/app/api/actions/**`
- **Reach**: Complete a prepared action (smoke: send success) and observe the toast region.
- **Verify**: manual
- **Expect**: exact success copy e.g. `Sent $1.00 to 0x2222…222222` (send.pw.ts); renders only when `routeMode === "dashboard" && isVerified` (shell.tsx).
- **States**: pending/confirmed/failed toast variants (client/home/action-toasts.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/home/action-toasts.tsx`, `/api/actions`.
- **Unknowns**: none; pending/confirmed verbs are defined for savings and Borrow operations, and failures use `<Action> failed: <reason>`.

## Gaps

**Playwright Reach replay:** `apps/web/tests/browser/feature-map-replay.pw.ts` exercises the
non-manual fixture Reaches for landing, sign-in, home-panel, balances, activity, save,
invest, send, account-settings, and coverage. Manual surfaces are explicitly skipped with reasons in the test. This only checks entry
steps; it does not cover borrow markets, activity pagination, invest categories or memes,
coverage filters, or dev-ui behavior.
**Journey stories:** Only `apps/web/stories/journeys/savings-deposit.stories.tsx` exists; every other surface above lacks one.

**Reach depends on a live provider and cannot run against the fixture server** (needs a documented fixture or an authorized live agent session):
- Base-account/CDP sign-in (`client/account/base-account-connector.tsx`, `cdp-*`), real Coinbase onramp/offramp providers via `/api/funding/providers`, `/api/funding/quotes`, `/api/funding/provider-customers`, and `/api/funding/webhooks/[provider]` (smoke uses hand-written IDRX/PEER stubs instead of a documented shared fixture).
- Real Basename/ENS resolution and reverse labels: the fixture-session helper intercepts `/api/transfers/recipient-name` and `/api/transfers/recent-recipients` with static bodies, so Base L2 Basename resolution, mainnet ENS resolution, and forward-verified reverse labels (`apps/web/server/transfers/recipient-resolver.ts`) are only exercised by an authorized live agent session or a non-fixture run.
- Invest `Memes` discovery (`/api/invest/discover`) and market prices (`/api/market-prices*`) when the fixture returns `{}` — smoke never asserts a meme shelf; treat as unknown rather than "empty".
- `/api/webhooks/cdp` and trades (`/api/trades`, `client/trading/trade-actions.tsx` buttons are `disabled` — trading is not user-reachable today).

**Performance observations**: the listed initial and live mark budgets are historical baselines, not CLI gates. Read named browser performance marks if performance is in scope; explain deviations in evidence rather than claiming a pass from a static number.

**Verification notes:** every selector quoted here was read from code or from `tests/browser/*.pw.ts`. Remaining Unknowns identify provider- or fixture-dependent behavior that code alone cannot confirm. The fixture baseline and kept-current trigger set are repository policy.
