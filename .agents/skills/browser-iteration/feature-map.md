# Home feature map

This is the enumerated map of every user-reachable surface in `apps/web`, written for agents that
drive the app with the repository-pinned `agent-browser` (see
`.agents/skills/browser-iteration/SKILL.md`, normalized by `docs/browser-validation.md`). Read it
before starting a browser session: pick the **surface id** you are changing, run `verify start
<surface-id>` and `verify snapshot`, and use **Reach** as guidance rather than a literal script.
Assert the **Expect** facts, exercise every listed **State** you touched, and run `verify finish`
to capture **Evidence** (screenshot, DOM text snapshot, console/errors, perf marks by name).
Use `verify confirm` for a prepared money control, never `verify click`. Selectors are quoted from
the file that defines them; anything not confirmed in code is in **Unknowns** — never invent a
selector when Reach is ambiguous, snapshot first.

**Keeping this current:** run a `chore(dx)` pass whenever `apps/web/app/**/page.tsx`, `apps/web/client/*/*-experience.tsx`, or
`apps/web/tests/browser/*.pw.ts` changes. State that bracket in the PR body; do not silently drift this map.
The CI Playwright replay in `apps/web/tests/browser/feature-map-replay.pw.ts` parses this map
through `verify/map.ts` and executes every non-manual fixture Reach. Keep its explicit skip
reasons and its canary dispositions aligned with the map when changing a Reach or fixture.

Fixture baseline referenced throughout: `HOME_PLAYWRIGHT_SMOKE=1`, rootless
`bun --cwd apps/web dev -- --port <port>` (`.agents/skills/browser-iteration/SKILL.md` §Factory loop),
session seed `sessionStorage["home:playwright-smoke:signed-in"]="1"` + `localStorage["home.country.v1"]`
(tests/browser/fixtures/api.ts `seedSignedInSession`), API interception `installApiFixtures`
(tests/browser/fixtures/api.ts); the send destination step's name and recent-recipient fixtures live in
tests/browser/send-recipients.pw.ts `installRecipientFixtures`, with matching static responses in
verify/fixtures.ts for the surface verifier. Balances snapshots from tests/browser/fixtures/balances.ts.

## Surface index

| id | family | route | auth state | fixture state needed | entry trigger |
|---|---|---|---|---|---|
| `landing` | home | `/` | anonymous (signed-in 307 → `/home`, app/page.tsx) | none (`SupportedGlobeDynamic`) | goto `/` |
| `sign-in` | account | `/?account=signin`, `/account` (redirect) | anonymous | `installApiFixtures` (session/OTP fixture) | header `Sign in` (shell-chrome.tsx) or goto `/?account=signin` |
| `home-panel` | home | `/home` | signed-in recommended; signed-out redirects to `/?account=signin` | signed-in seed + `/api/session`, `/api/balances` fixtures | the `.` landing `Open dashboard`/post-OTP `router.replace("/home")` (shell.tsx) |
| `balances` | home/balances | `/balances`, `/balances/cash`, `/balances/investments` | same as home-panel | signed-in seed + balances fixture; `scrollableBalancesSnapshot()` for reveal/scroll | Main navigation `Home` → "Your money" card `See all` (home-panel.tsx `SectionHeader`), or goto path |
| `activity` | activity | `/activity` | same | signed-in seed + `/api/activity`, `/api/actions` fixtures | Home panel `Activity` card action (home-panel.tsx), goto path |
| `save` | savings | `/save`, `?flow=save-deposit`, `?flow=save-withdraw` | same | `HOME_PLAYWRIGHT_SMOKE=1`; `/api/savings/vaults` fixture present in tests/browser/fixtures/api.ts `installApiFixtures` | Home panel Save card (`SavingsTeaser`), goto `/save?flow=save-deposit` |
| `borrow` | borrowing | `/borrow`, `/borrow/<marketId>` | same | session + borrow market fixtures | Home panel Borrow card (`AuthenticatedBorrowTeaser`), goto path |
| `invest` | invest | `/invest`, `/invest/stocks|crypto|memes`, `/invest/<assetId>` | same | session + `/api/invest/discover`, `/api/market-prices` fixtures | Main navigation `Invest` button (primary-navigation.tsx), goto path |
| `send` (money modal) | transfers/money-modal | overlay on any shell route: `?flow=send` | signed-in (button disabled pre-boundary, transfer-actions.tsx) | signed-in seed + `/api/actions/prepare`, `[id]/confirm`, `[id]/handle`, `/api/transfers/recipient-name`, `/api/transfers/recent-recipients` fixtures | `Send` button, `data-action-trigger` (transfer-actions.tsx) |
| `add-money` (funding) | funding | overlay on any shell route: `?flow=add-money` or `?flow=receive`; `/fund` redirects to `/home?add-money=1` (app/fund/page.tsx) | signed-in for methods; signed-out shows `Sign in` link (add-money-dialog.tsx) | provider fixture (`/api/funding/providers`); IDRX path in funding.pw.ts | `Add money` button (funding-actions.tsx) |
| `cash-out` (Peer offramp) | transfers/funding | inner steps of `send`: payout/handle/handle-confirm | signed-in, region with offramp provider | PEER_OFFRAMP stub and `openPeerCashOutHandle` in mobile-geometry.pw.ts | `Send` → amount → `Continue` → `Send to Zelle, Venmo, Cash App and more` (send-dialog.tsx `CashoutItem`) |
| `account-settings` | account | `/?account=settings` (dashboards commit `?account=settings`, shell.tsx `openAccountSettings`) | signed-in verified | signed-in seed | header profile mark (`ProfileMark`, shell-chrome.tsx) → settings; or goto `/home?account=settings` |
| `access-gate` | access | `/access?next=%2Fhome` | anonymous (deployment gate; env-driven, app/access/page.tsx) | `HOME_ACCESS_PASSWORD` env (tests/browser/access.pw.ts) | protected request redirects to `/access` |
| `coverage` | coverage | `/coverage` | public | none | goto `/coverage` (also `/coverage.csv`) |
| `dev-ui` | coverage/dev | `/dev/ui` | public only when `HOME_PLAYWRIGHT_SMOKE=1` or dev (app/dev/ui/page.tsx) | `HOME_PLAYWRIGHT_SMOKE=1` | goto `/dev/ui` |
| `toasts` | home | any dashboard route after action | signed-in | action fixture (tests/browser/fixtures/api.ts; send.pw.ts) | action completion (action-toasts.tsx) |

API routes (no UI; listed for request-level assertions): `app/api/{access,access/logout,session,balances,activity,client-errors,client-performance,actions,actions/prepare,actions/[id],actions/[id]/confirm,actions/[id]/handle,auth/base/{nonce,verify,logout},borrow,borrow/markets/[marketId],funding/{providers,quotes,orders,orders/[id],offramp/orders,provider-customers,provider-customers/verification,webhooks/[provider]},invest/discover,market-prices,market-prices/history,savings/vaults,trades,transfers/{recipient-name,recent-recipients},webhooks/cdp}`. `/api/actions/*`, `/api/activity`, `/api/balances`, `/api/borrow`, `/api/borrow/markets/[marketId]`, and `/api/transfers/*` require `authorizeSession`; provider and public route authorization remains route-specific.

## Live hosts

Hosts Home is known to call from the browser on a deployed environment, with the code that issues
each call. `verify --live` composes this list with the base host, the CDP provider origins in
`apps/web/verify/live.ts`, and repeated `--allow-domain` values; any other hostname stays in
`unexpectedHosts` and fails the run.

- `media.thegrid.id`, `token-media.defined.fi` — token artwork returned by the Codex token-image lookup (`apps/web/server/market-data/codex/token-images.ts:68`) and rendered by asset marks such as the borrow market header (`apps/web/client/borrowing/borrowing-experience.tsx:440`) and the invest list; both observed in the first studio canary on 2026-09-22.
- `api.ensideas.com` — Basename profile lookup (`apps/web/client/account/basename-profile.ts:9`); observed in the first production run on 2026-09-21.
- `api.cdp.coinbase.com` — CDP browser session and Coinbase onramp API (`apps/web/server/funding/providers/coinbase/manifest.ts:5`).
- `secure-wallet.cdp.coinbase.com` — CDP embedded-wallet origin (`apps/web/verify/live.ts:6`).
- `pay.coinbase.com` — Coinbase onramp embed and redirect (`apps/web/server/funding/providers/coinbase/manifest.ts:6`; rendered by `apps/web/client/funding/order-flow.tsx:685`).
- `checkout.idrx.co` — IDRX checkout redirect (`apps/web/server/funding/providers/idrx/manifest.ts:6`).
- `skala.ripio.com` — Ripio onramp API and payment redirect (`apps/web/server/funding/providers/ripio/manifest.ts:5`).
- `kyc.ripio.com` — Ripio customer KYC handoff (`apps/web/server/funding/providers/ripio/manifest.ts:6`).

Recipient-name resolution is server-side (`apps/web/server/transfers/recipient-resolver.ts`), so the browser still calls only `api.ensideas.com` for names; the resolver origin is not a new browser host.

## Live expected failures

Deployments return these request failures on every load. `verify --live` matches failures from the
browser network log by exact method, path, and status (query strings and fragments ignored) and
reports them as expected failures in `live.json` and `summary.md` instead of failing the run. Any
request failure not listed here still fails the run, and unlisted hosts still fail as
`unexpectedHosts`.

- `GET /api/session` 401 — the restore path probes the session endpoint before the CDP SDK holds a server-accepted access token (#735).
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
  3. `expect "Recognized Coin"`
- **Reach (live)**:
  1. `goto "/home"`
  2. `expect "Total balance"`
  3. `expect "Your money"`
- **Notes**: The verifier seeds the signed-in session and API fixtures. Optionally click `Send` for the money modal or exercise the card actions below.
- **Expect**: `Total balance` card with `aria-label="Total balance"` and `aria-busy` while loading (home-panel.tsx); balance breakdown (`data-balance-breakdown`, `data-balance-segment="cash|saved|investments"`, home-panel.tsx); status line `[data-total-status]` when `statusLabel` present; money actions group `aria-label="Money actions"` with `Add money` and `Send`; `Your money` card (h2 `your-money-heading`) with `See all` action; Save card (`save-heading`), Borrow card (`borrow-heading`); Activity card (`activity-title`). Fixture-visible rows include `Recognized Coin` (tests/browser/fixtures/balances.ts `recognizedCatalogHolding`).
- **States** (fixtures): loading → hold `/api/session`/`/api/balances` with `fixtures.delayNextSession()/delayNextBalances()` (balances.pw.ts and save.pw.ts); empty → base fixture minus holdings (**no ready empty fixture exists — construct via `options.balances`**); unavailable → `status: "unavailable"` presentation (home-panel.tsx `Balance unavailable`); error state for action APIs is surfaced in the modal, not the panel.
- **Evidence**: screenshot; DOM text snapshot; console/errors; perf marks `shell:paint`, `session:verified` (shell.tsx:356), `balances:painted` (shell.tsx:402), `action:first-interactive` (client/transfers/transfer-actions.tsx:82). `balances:painted` keeps the smoke suite budget (CI 3,500 / local 1,000 ms); the CLI uses the initial cross-environment budget below without changing smoke.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/home/`, data `apps/web/server/balances/*`, `/api/balances` route.
- **Unknowns**: `statusLabel` copy is supplied by balance presentation data and therefore varies by snapshot. `MountedShellPanel` sets inactive panels to `hidden`, `inert`, and `aria-hidden`.

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
- **Notes**: The verifier seeds the signed-in session and balances fixture. Use `/balances/investments` with `scrollableBalancesSnapshot()` for anchoring work; the group section is `id="investments"`.
- **Expect**: scroll container `[data-app-main-authenticated]` (shell-panels.tsx); balance rows `[data-balance-list] [data-kind="balance"]` (balances.pw.ts); reveal window grows after scroll (`BALANCES_BATCH_SIZE = 10`, client/home/balances-panel.tsx); `Show small balances` switch lives in account settings, not this page (mobile-geometry.pw.ts touch test).
- **States**: loading shimmer (`LoadingMoneyGroup`, balances-panel.tsx); unavailable; empty (`BalancesEmpty`); ready with reveal batches; stale revalidation anchored to requested group (`cold and revalidated cached Balances…` smoke test).
- **Evidence**: screenshot; DOM snapshot; console/errors; perf marks and scroll-offset assertions.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/home/balances-panel.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/client/balances/use-balances.ts`, `/api/balances`.
- **Unknowns**: none; incremental batches use an intersection sentinel rather than a reveal-more button, group navigation is labelled `More <group>`, and the empty state is `No money yet`.

### `activity`
- **Live**: read-only
- **Owned paths**: `apps/web/app/activity/**`, `apps/web/client/activity/**`, `apps/web/client/home/activity-panel.tsx`, `apps/web/app/api/activity/**`
- **Reach**:
  1. `goto "/activity"`
  2. `expect "Activity"`
- **Notes**: The verifier seeds the signed-in session and API fixtures. Add `/api/activity` fixture rows when exercising populated states; the Home Activity card is the interactive entry point.
- **Expect**: `Activity` heading (`#activity-title`, client/activity/activity-panel.tsx `DefaultActivityHeader`); empty state `No activity yet`; end marker `End of activity`; error `Try again` button; later-page failure shows a concise `Retry`; rows expose `View <direction> <symbol> transaction details` activation labels (activity-panel.tsx `TransferActivityRow`).
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
  7. `click "Deposit $0.10"`
  8. `expect "Deposited $0.10"`
- **Notes**: The Save smoke path opens a deep-linked Deposit and dismisses it with Close and browser Back; it also opens Deposit and Withdraw from their buttons, closes via Close or Escape, and asserts focus returns to the exact opener.
- **Expect**: section `role="region"`/`aria-label="Save"` hosted variant (savings-experience.tsx); vault radiogroup `aria-label="Vault"`; `Nothing saved yet` empty; action buttons `Get started` (unfunded) / `Deposit` + `Withdraw` (funded) (savings-experience.tsx); dialog labels from `closeLabel={Close ${mode} dialog}` and `primaryLabel` `Continue` → `Deposit $X`/`Withdraw $X`/`Retry` (savings-actions.tsx lines ~251–350).
- **States**: cold loading (`data-shimmer="savings-hero"`, `savings-apy`); vaults loading `aria-busy`; vaults error `Vaults are temporarily unavailable.` + `Retry`; stale alerts `Saved balance stale…` / `Vault rates stale…`; deposit/withdraw amount → confirm → pending (`Waiting for your wallet…`) → error/failed.
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
  7. `click "Confirm action"`
  8. `expect "Borrowed $0.10"`
- **Verify**: manual
- **Notes**: No smoke fixture exists for `/api/borrow*`; see Gaps. Live: the `1` chip renders only when the pinned account holds the market's collateral (`You need cbBTC in this wallet before you can borrow.`); the production bot account held none on 2026-09-22, so the canary reports `did not render` until it is funded.
- **Expect**: heading `Borrow` (`#borrow-overview-title`, `#borrow-direct-title`, borrowing-experience.tsx); position actions including `Borrow`, `Supply`/`Withdraw collateral from Bitcoin position` (`aria-label`, line 539); `Back to Borrow`; `Market values are unavailable` + `Retry` error; collateral preview `data-testid="borrow-collateral-preview"`; action money modal title `Confirm`, footer `Confirm action`/`Retry`/`Back`/`Close` (lines ~712–782).
- **States**: loading/error via `overview.refetch()`/`detail.refetch()` buttons; amount → confirm → pending (`Waiting for your wallet…`, `#borrow-action-pending`) → error/failed.
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/borrowing/`, `apps/web/server/*` borrow modules, `/api/borrow`, `/api/borrow/markets/[marketId]`.
- **Unknowns**: no fixture-backed browser smoke state exists. Operation labels are `Add collateral`, `Borrow`, `Repay`, `Repay all`, `Withdraw collateral`, and `Close position`.

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
  3. `expect "Recognized Coin"`
  4. `click "Send"`
  5. `expect "Send"`
  6. `click "1"`
  7. `click "Continue"`
  8. `expect "Recent recipients"`
  9. `fill "To" "jesse.base.eth"`
  10. `expect "Resolves to"`
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Send"`
  3. `click "Decimal point"`
  4. `click "1"`
  5. `click "Continue"`
  6. `fill "To" "<recipient>"`
  7. `click "Continue"`
  8. `expect "Confirm"`
  9. `click "Send $0.10"`
  10. `expect "Sent $0.10"`
- **Notes**: The dialog is labelled by `send-title`. Live mode replaces `<recipient>` with the effective recipient's **name** only in that `To` fill step, so the run exercises the product's own resolution path; any other step containing `<recipient>` refuses before browser launch. `--recipient` accepts a bare 40-hex `0x` address other than the zero address, or the name `jesse.base.eth` matched case-insensitively with surrounding whitespace ignored (its pinned address is `0x2211d1d0020daea8039e46cf1367962070d77da9`), and defaults to that pinned name when omitted; every other value refuses before browser launch. Before the gated `Send $0.10` confirm click the verifier requires exactly one review `To` row to show the full **pinned address** of the effective recipient (case-insensitive) and stops with `recipientMismatch` otherwise. Fixture-backed coverage for the destination step's name and recent-recipient behavior is tests/browser/send-recipients.pw.ts (`installRecipientFixtures`); the verifier's fixture mode reaches the same steps through verify/fixtures.ts.
  1. **amount**: type digits via keypad buttons named `0`–`9`, `Decimal point`, `Delete last digit` (`role="group" aria-label="Amount keypad"`, client/money-modal/amount.tsx:581–601); quick chips group `Quick amounts` (`$10`/`$25`/`Max` when priced, amount.tsx:508+). Primary `Continue` disabled until positive amount (`isPositiveDecimalAmount`).
  2. **destination**: step title stays `Send`; field label `To` (AddressField `id="send-recipient"`); primary `Continue` disabled until the typed value is a valid `0x` recipient or a resolved name (send-dialog.tsx `effectiveRecipient`). A `.eth` Basename/ENS value is resolved through `GET /api/transfers/recipient-name?name=…` and shows `Resolves to <full address>` under the field; while it resolves the field is described by `Resolving <name>…`; an unresolved or unsupported value shows an inline `role="alert"`/hint and never enables `Continue`. The account's own recent send recipients render below the `Or` separator under the group label `Recent recipients` (labelled by reverse-resolved name with the truncated address beneath, or the truncated address alone) and selecting one fills `To`.
  3. **confirm**: dialog title becomes `Confirm` (send-dialog.tsx `modalTitle`); summary via `MoneyConfirmSummary` rows `To` (CopyableValue full address), `Asset`, `Network` = `Base` (send-dialog.tsx); primary button `Send $1.00` where amount is `MoneyTicker(confirmAmount)` — smoke clicks `getByRole("button", { name: "Send $1.00" })`; secondary `Back`.
  Every money confirm control (every surface) carries `data-money-action-id=<prepared action id>` (client/money-modal/money-modal.tsx `MoneyConfirmFooter`); no other control does.
  4. **pending**: `Waiting for your wallet…` status (send-dialog.tsx); close disabled.
  5. **error**: message + `Try again` (primary) and `Back`; the "ambiguous handle response retries without a second wallet dispatch" test asserts `Try again` then `Send $1.00` again and `sessionStorage["home:playwright-smoke:dispatch-count"] === "1"` (send.pw.ts).
  6. **success/status**: dialog closes; toast `Sent $1.00 to 0x2222…222222` (exact text, send.pw.ts; toast owned by client/home/action-toasts.tsx).
- **Expect**: prepared action via `POST /api/actions/prepare` with a checksummed `0x` `recipient` and, for a name entry, `recipientName` re-resolved server-side (server rejects a name/address mismatch); recent recipients via `GET /api/transfers/recent-recipients` on dialog open, derived from this account's successfully dispatched durable send actions; confirm/handle via `/api/actions/[id]/{confirm,handle}` (smoke fixtures); dialog uses `data-money-sheet` / `data-money-sheet-grabber` (client/money-modal/money-modal.tsx) and reduced-motion transitions are `0s` (send.pw.ts ambiguous-handle retry test).
- **States**: asset picker (`aria-label="Asset"`, amount.tsx:443) with multiple assets; no catalog balance → `No catalog balance is available to send.`; rejected/unknown wallet results via `messageForError` (send-dialog.tsx); destination resolving/resolved/unresolved/unsupported-input states above; recent-recipients list empty (no confirmed sends) or populated; a superseded name resolution must not enable `Continue` (client/transfers/send-dialog-recipients.test.tsx).
- **Evidence**: screenshots per step; DOM snapshot per step (re-snapshot after every material DOM change per SKILL.md); console/errors; startup and first-action marks.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/money-modal/`, `apps/web/shared/transfers/`, `apps/web/server/actions/` (prepare/confirm/handle/list), `apps/web/server/money-actions/`, `apps/web/server/transfers/`, routes `apps/web/app/api/actions/**` and `apps/web/app/api/transfers/**`.
- **Unknowns**: none blocking; exact `MoneyConfirmSummary` fee row for sends (sends show no fee row — wallet shows fee; fixture `warnings` say `Network fee shown by wallet.`).

### `cash-out` (Peer offramp inner steps)
- **Live**: confirm
- **Owned paths**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/app/api/funding/offramp/**`, `apps/web/server/funding/offramp/**`
- **Confirm labels**: "Cash out $<amount>", "Withdraw $<amount>"
- **Reach** (smoke-verified through re-entry, `openPeerCashOutHandle`, mobile-geometry.pw.ts): 1) seed + `installApiFixtures`. 2) `Send` → digits `1` → `Continue`. 3) click `/Send to Zelle, Venmo, Cash App and more/` (CashoutItem, send-dialog.tsx). 4) click `Cash App` (payment-method button, payout step). 5) textbox `Cash App handle` (label `${selectedPlatform.label} handle`); smoke asserts 16px font and ≥44px portrait target. 6) fill `$alice`, click `Continue` → visible textbox `Re-enter handle`; smoke asserts 16px font and ≥44px portrait target. Input hints (`autocomplete`, `autocapitalize`, `autocorrect`, `spellcheck`, `enterkeyhint`) and `Review` → confirm behavior are asserted in client/transfers/send-dialog.test.tsx, not browser smoke.
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Send"`
  3. `click "Decimal point"`
  4. `click "1"`
  5. `click "Continue"`
  6. `click "Available payout apps: Cash App, Zelle Send to Zelle, Venmo, Cash App and more Use Peer to send via app"` (the payout marks contribute their `Available payout apps:` name; the list follows the US corridor order)
  7. `click "Cash App"`
  8. `fill "Cash App handle" "$alice"` — live substitutes `HOME_VERIFY_CASHOUT_HANDLE` for `$alice`; unset refuses before any fill
  9. `click "Continue"`
  10. `fill "Re-enter handle" "$alice"` — live substitutes the Cash App canonical form of `HOME_VERIFY_CASHOUT_HANDLE` (leading `$` stripped, `shared/funding/cash-payee.ts`), because Review enables only when the re-entry equals the canonical handle (send-dialog.tsx `handleConfirmation !== canonicalHandle`); unset refuses before any fill
  11. `click "Review"`
  12. `expect "Approximate receive"` — the deposit review's approximate fiat row, absent from a withdrawal review
  13. `expect "Confirm"`
- **Canary operations**: `--canary-operation cash-out` appends `click "Cash out $0.10"` and `expect "Cashed out $0.10"` (the deposit confirmation). `--canary-operation withdraw` is its own Reach: `goto "/home"`, `click "Send"`, `click "Decimal point"`, `click "1"`, `click "Continue"`, `expect "Use Peer to send via app"` (the destination step, where in-flight orders are listed), `click-prefix "Withdraw "` (the in-flight recovery item, which reads `Withdraw $0.10 Peer cash-out · awaiting-buyer`; it is marked as opening a review, so the amount-bearing-control refusal does not apply to it, and the verifier waits up to 15 s for a match before concluding none), `expect "Confirm"`, `click-prefix "Withdraw $"` (the confirm control), `expect "Recovered $"`. Both require `HOME_VERIFY_CASHOUT_HANDLE`, and immediately before the confirm click the review must carry a `Payout handle` row equal to its Cash App canonical form; the canonical handle is recorded as `confirmIntent.recipient` and redacted from text evidence. When the first `click-prefix "Withdraw "` matches nothing, nothing is in flight: the run ends with exit 0, a `note` in `live.json`, `No in-flight Peer cash-out to withdraw.` in `summary.md`, and rung 2.
- **Verify**: manual
- **Expect**: modal title `Cash out with Peer` (send-dialog.tsx `modalTitle`); confirm rows `Provider`, `Payout app`, `Payout handle`, `Approximate receive`, `Estimated delivery`, `Network` = `Base` (send-dialog.tsx confirm rows); disclaimer `The fiat amount and delivery time are approximate, not guaranteed.`; primary `Cash out $X` or `Withdraw $X`, where the amount is the reviewed USDC amount rendered in dollars (`formatUsdStablecoinAmount`).
- **States**: providers not loaded → CashoutItem absent (requires `PEER_OFFRAMP` stub registered after `installApiFixtures` via `route.fallback`, mobile-geometry.pw.ts); recovery items `Withdraw <amount>` for active orders; `Recover a Peer cash-out` button when `recoveryEligible` (send-dialog.tsx).
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
- **Expect**: dialog titles `Add money` / `Receive` / `Deposit IDR` (add-money-dialog.tsx `title`); method list has `Receive crypto` row; close label `Close add money`; receive step QR (`aria-label="QR code for Base address …"`) and address copy (`Copy …`, `Full Base address …`, add-money-dialog.tsx). Signed-out body offers `Sign in` link to `/?account=signin`.
- **States**: method loading (`providerBindingsDisabled={!ordersQuery.isSuccess}`); `Funding methods are unavailable. Try again.` / `Home couldn't check for an open deposit. Retry.` / `Home couldn't check your provider setup. Retry.` (funding-experience.tsx); resumable open order auto-jumps to `order` step (funding-experience.tsx); customer/KYC step for providers with `customerSetup`.
- **Evidence**: screenshots per step; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/funding/{funding-actions,funding-experience,add-money-dialog,order-flow,receive-qr}.tsx`, `/api/funding/*`.
- **Unknowns**: provider-specific order-flow labels outside the smoke-verified IDRX path remain unknown because they depend on provider configuration; snapshot before acting.

### `account-settings`
- **Live**: read-only
- **Owned paths**: `apps/web/client/account/account-settings.tsx`, `apps/web/client/home/shell-panels.tsx`, `apps/web/client/home/use-show-small-balances.ts`
- **Reach**:
  1. `goto "/home?account=settings"`
  2. `expect "Account"`
- **Notes**: The verifier seeds the signed-in session and fixtures. The Chromium smoke opens the header profile mark with the keyboard, asserts focus enters the settings region, closes through Done and browser Back, restores the exact opener, exercises deep-link and forward-history entry, and verifies every primary-navigation `aria-controls` target remains unique and present. Live: the Peer option renders only where `PEER_OFFRAMP_ENABLED` is set on the target (`apps/web/server/funding/providers/peer/manifest.ts:51`); production keeps it off pending the provider README's staging and corridor confirmations, so the canary reports `did not render` for cash-out until then.
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
- **Expect**: headings `Enter access password` / `Access granted`; `Continue to Home` link; CSP header `frame-ancestors 'none'` on the protected response (tests/browser/access.pw.ts); hydrated form marker `form[data-hydrated="true"]`.
- **States**: `misconfigured` → `Access is temporarily unavailable.`; `disabled` → `Continue to Home` (app/access/page.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/access/page.tsx`, `apps/web/server/access/*`, `/api/access`.
- **Unknowns**: cookie/secret names intentional; do not print credentials.

### `coverage`
- **Live**: read-only
- **Owned paths**: `apps/web/app/coverage/**`, `apps/web/client/coverage/**`, `apps/web/config/coverage.ts`, `apps/web/components/ui/coverage-table.tsx`
- **Reach**:
  1. `goto "/coverage"`
  2. `expect "Local money coverage"`
- **Notes**: Exercise the four native comboboxes for search, issuer, Home status, and priority plus the `sort` query parameter when validating filters.
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
invest, send, account-settings, and coverage. Manual surfaces and fixture-impossible
canary operations are explicitly skipped with reasons in the test. This only checks entry
steps; it does not cover borrow markets, activity pagination, invest categories or memes,
coverage filters, or dev-ui behavior.
**Journey stories:** Only `apps/web/stories/journeys/savings-deposit.stories.tsx` exists; every other surface above lacks one.

**Reach depends on a live provider and cannot run against the fixture server** (needs a documented fixture or the provisioned verifier Live mode):
- Base-account/CDP sign-in (`client/account/base-account-connector.tsx`, `cdp-*`), real Coinbase onramp/offramp providers via `/api/funding/providers`, `/api/funding/quotes`, `/api/funding/provider-customers`, and `/api/funding/webhooks/[provider]` (smoke uses hand-written IDRX/PEER stubs instead of a documented shared fixture).
- Real Basename/ENS resolution and reverse labels: the fixture server serves `/api/transfers/recipient-name` and `/api/transfers/recent-recipients` from static bodies, so Base L2 Basename resolution, mainnet ENS resolution, and forward-verified reverse labels (`apps/web/server/transfers/recipient-resolver.ts`) are only exercised by verifier Live mode or a non-fixture run.
- Invest `Memes` discovery (`/api/invest/discover`) and market prices (`/api/market-prices*`) when the fixture returns `{}` — smoke never asserts a meme shelf; treat as unknown rather than "empty".
- `/api/webhooks/cdp` and trades (`/api/trades`, `client/trading/trade-actions.tsx` buttons are `disabled` — trading is not user-reachable today).

**Initial perf budgets**: the CLI budgets are deliberately broader than local smoke timing and apply only when listed on a surface. They establish a measured baseline for `shell:paint`, `session:verified`, and `action:first-interactive`; the existing smoke budget for `balances:painted` is unchanged. A surface's `Live perf budgets` line overrides those marks only under `--live`: `session:verified` allows 10_000 ms there because the live CDP sign-in round trip varies with the runner's network (the studio canary measured 3_327 ms against 3_000 ms while every other mark and request passed); fixture runs keep 3_000 ms.

**Verification notes:** every selector quoted here was read from code or from `tests/browser/*.pw.ts`. Remaining Unknowns identify provider- or fixture-dependent behavior that code alone cannot confirm. The fixture baseline and kept-current trigger set are repository policy.
