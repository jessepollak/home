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
`apps/web/tests/browser/smoke.pw.ts` changes. State that bracket in the PR body; do not silently drift this map.

Fixture baseline referenced throughout: `HOME_PLAYWRIGHT_SMOKE=1`, rootless
`bun --cwd apps/web dev -- --port <port>` (`.agents/skills/browser-iteration/SKILL.md` §Factory loop),
session seed `sessionStorage["home:playwright-smoke:signed-in"]="1"` + `localStorage["home.country.v1"]`
(tests/browser/smoke.pw.ts `seedSignedInSession`), API interception `installApiFixtures`
(tests/browser/smoke.pw.ts), balances snapshots from tests/browser/balances-fixtures.ts.

## Surface index

| id | family | route | auth state | fixture state needed | entry trigger |
|---|---|---|---|---|---|
| `landing` | home | `/` | anonymous (signed-in 307 → `/home`, app/page.tsx) | none (`SupportedGlobeDynamic`) | goto `/` |
| `sign-in` | account | `/?account=signin`, `/account` (redirect) | anonymous | `installApiFixtures` (session/OTP fixture) | header `Sign in` (shell-chrome.tsx) or goto `/?account=signin` |
| `home-panel` | home | `/home` | signed-in recommended; signed-out redirects to `/?account=signin` | signed-in seed + `/api/session`, `/api/balances` fixtures | the `.` landing `Open dashboard`/post-OTP `router.replace("/home")` (shell.tsx) |
| `balances` | home/balances | `/balances`, `/balances/cash`, `/balances/investments` | same as home-panel | signed-in seed + balances fixture; `scrollableBalancesSnapshot()` for reveal/scroll | Main navigation `Home` → "Your money" card `See all` (home-panel.tsx `SectionHeader`), or goto path |
| `activity` | activity | `/activity` | same | signed-in seed + `/api/activity`, `/api/actions` fixtures | Home panel `Activity` card action (home-panel.tsx), goto path |
| `save` | savings | `/save`, `?flow=save-deposit`, `?flow=save-withdraw` | same | `HOME_PLAYWRIGHT_SMOKE=1`; `/api/savings/vaults` fixture present in smoke.pw.ts `installApiFixtures` | Home panel Save card (`SavingsTeaser`), goto `/save?flow=save-deposit` |
| `borrow` | borrowing | `/borrow`, `/borrow/<marketId>` | same | session + borrow market fixtures | Home panel Borrow card (`AuthenticatedBorrowTeaser`), goto path |
| `invest` | invest | `/invest`, `/invest/stocks|crypto|memes`, `/invest/<assetId>` | same | session + `/api/invest/discover`, `/api/market-prices` fixtures | Main navigation `Invest` button (primary-navigation.tsx), goto path |
| `send` (money modal) | transfers/money-modal | overlay on any shell route: `?flow=send` | signed-in (button disabled pre-boundary, transfer-actions.tsx) | signed-in seed + `/api/actions/prepare`, `[id]/confirm`, `[id]/handle` fixtures | `Send` button, `data-action-trigger` (transfer-actions.tsx) |
| `add-money` (funding) | funding | overlay on any shell route: `?flow=add-money` or `?flow=receive`; `/fund` redirects to `/home?add-money=1` (app/fund/page.tsx) | signed-in for methods; signed-out shows `Sign in` link (add-money-dialog.tsx) | provider fixture (`/api/funding/providers`); smoke IDRX fixture in smoke.pw.ts | `Add money` button (funding-actions.tsx) |
| `cash-out` (Peer offramp) | transfers/funding | inner steps of `send`: payout/handle/handle-confirm | signed-in, region with offramp provider | PEER_OFFRAMP stub in smoke.pw.ts `openPeerCashOutHandle` | `Send` → amount → `Continue` → `Send to Zelle, Venmo, Cash App and more` (send-dialog.tsx `CashoutItem`) |
| `account-settings` | account | `/?account=settings` (dashboards commit `?account=settings`, shell.tsx `openAccountSettings`) | signed-in verified | signed-in seed | header profile mark (`ProfileMark`, shell-chrome.tsx) → settings; or goto `/home?account=settings` |
| `access-gate` | access | `/access?next=%2Fhome` | anonymous (deployment gate; env-driven, app/access/page.tsx) | `HOME_ACCESS_PASSWORD` env (tests/browser/access.pw.ts) | protected request redirects to `/access` |
| `coverage` | coverage | `/coverage` | public | none | goto `/coverage` (also `/coverage.csv`) |
| `dev-ui` | coverage/dev | `/dev/ui` | public only when `HOME_PLAYWRIGHT_SMOKE=1` or dev (app/dev/ui/page.tsx) | `HOME_PLAYWRIGHT_SMOKE=1` | goto `/dev/ui` |
| `toasts` | home | any dashboard route after action | signed-in | action fixture (smoke.pw.ts) | action completion (action-toasts.tsx) |

API routes (no UI; listed for request-level assertions): `app/api/{access,access/logout,session,balances,activity,client-errors,client-performance,actions,actions/prepare,actions/[id],actions/[id]/confirm,actions/[id]/handle,auth/base/{nonce,verify,logout},borrow,borrow/markets/[marketId],funding/{providers,quotes,orders,orders/[id],offramp/orders,provider-customers,provider-customers/verification,webhooks/[provider]},invest/discover,market-prices,market-prices/history,savings/vaults,trades,webhooks/cdp}`. `/api/actions/*`, `/api/activity`, `/api/balances`, `/api/borrow`, and `/api/borrow/markets/[marketId]` require `authorizeSession`; provider and public route authorization remains route-specific.

## Surfaces

### `landing`
- **Live**: read-only
- **Reach**:
  1. `goto "/"`
  2. `expect "One home for your money."`
- **Notes**: Optionally use a 900×844 viewport for the pointer-fine layout used by smoke.
- **Expect**: `h1` `One home for your money.` (client/home/shell-chrome.tsx, `landing-title`); subtitle `Invest in any asset, earn more on your savings, and grow your wealth.` (same file); buttons `Sign in` and, when `account.signInAvailability === "ready"`, `Create account` (shell-chrome.tsx); header `Sign in` in `role="banner"` (tests/browser/smoke.pw.ts "wide touch targets…" test); globe visual `SupportedGlobeDynamic` (app/page.tsx). Signed-in request 307s to `/home` (tests/browser/landing-route.pw.ts).
- **States**: anonymous default; `isVerified` landing variant swaps in `Open dashboard` (shell-chrome.tsx); `sign-out-error` variant shows destructive Alert with `Retry sign out`.
- **Evidence to capture**: screenshot (mobile + desktop); DOM text snapshot; console errors + failed requests (expected none; the globe renderer uses a local dynamic import and makes no application network request); perf marks: `shell:paint` fires here too (client/home/shell.tsx rAF), but `balances:painted`/`session:verified` are dashboard-only.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms.
- **Owned by**: `apps/web/client/landing/`, `apps/web/client/home/shell-chrome.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/app/page.tsx`.
- **Unknowns**: none; `supported-globe.tsx` only dynamically imports the local renderer and does not fetch remote data.

### `sign-in`
- **Live**: read-only
- **Reach**:
  1. `goto "/?account=signin"`
  2. `expect "Sign in to Home"`
- **Notes**: The smoke path installs API fixtures, fills `Email address`, presses Enter, fills `Verification code` with `123456`, clicks `Verify and continue`, and expects `/home`.
- **Expect**: dialog labelled `Sign in to Home` (client/account/account-screen.tsx); email + OTP steps; after verify `router.replace("/home")` (shell.tsx `AccountSignInSheet onVerified`). Signed-out visiting `/home`/`/save` lands on `/?account=signin` (smoke.pw.ts).
- **States**: email step; OTP step; error/execution variants (`That code is not valid. Check the six digits and try again.`, `Try again`, and the resend countdown/`Resend code`); Base-account (CDP) connector variant (sign-in-base-account.tsx) — operator/live path.
- **Evidence**: screenshot of dialog; DOM snapshot; console/errors; marks n/a (`shell:paint` may fire on the root page).
- **Owned by**: `apps/web/client/account/{account-screen,sign-in-email,sign-in-otp,sign-in-shell,sign-in-copy}.tsx`, server `apps/web/server/auth/*` (`authorize.ts`, `render-session.ts`, `native-base-session.ts` per app/layout.tsx).
- **Unknowns**: none; the labels, invalid-code recovery, and resend countdown are defined in `sign-in-email.tsx`, `sign-in-otp.tsx`, and `account-screen.tsx`.

### `home-panel`
- **Live**: read-only
- **Reach**:
  1. `goto "/home"`
  2. `expect "Home"`
  3. `expect "Recognized Coin"`
- **Notes**: The verifier seeds the signed-in session and API fixtures. Optionally click `Send` for the money modal or exercise the card actions below.
- **Expect**: `Total balance` card with `aria-label="Total balance"` and `aria-busy` while loading (home-panel.tsx); balance breakdown (`data-balance-breakdown`, `data-balance-segment="cash|saved|investments"`, home-panel.tsx); status line `[data-total-status]` when `statusLabel` present; money actions group `aria-label="Money actions"` with `Add money` and `Send`; `Your money` card (h2 `your-money-heading`) with `See all` action; Save card (`save-heading`), Borrow card (`borrow-heading`); Activity card (`activity-title`). Fixture-visible rows include `Recognized Coin` (balances-fixtures.ts recognizedCatalogHolding).
- **States** (fixtures): loading → hold `/api/session`/`/api/balances` with `fixtures.delayNextSession()/delayNextBalances()` (smoke.pw.ts); empty → base fixture minus holdings (**no ready empty fixture exists — construct via `options.balances`**); unavailable → `status: "unavailable"` presentation (home-panel.tsx `Balance unavailable`); error state for action APIs is surfaced in the modal, not the panel.
- **Evidence**: screenshot; DOM text snapshot; console/errors; perf marks `shell:paint`, `session:verified` (shell.tsx:356), `balances:painted` (shell.tsx:402), `action:first-interactive` (client/transfers/transfer-actions.tsx:82). `balances:painted` keeps the smoke suite budget (CI 3,500 / local 1,000 ms); the CLI uses the initial cross-environment budget below without changing smoke.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Owned by**: `apps/web/client/home/`, data `apps/web/server/balances/*`, `/api/balances` route.
- **Unknowns**: `statusLabel` copy is supplied by balance presentation data and therefore varies by snapshot. `MountedShellPanel` sets inactive panels to `hidden`, `inert`, and `aria-hidden`.

### `balances`
- **Live**: read-only
- **Reach**:
  1. `goto "/balances"`
  2. `expect "Your money"`
  3. `expect "Recognized Coin"`
- **Notes**: The verifier seeds the signed-in session and balances fixture. Use `/balances/investments` with `scrollableBalancesSnapshot()` for anchoring work; the group section is `id="investments"`.
- **Expect**: scroll container `[data-app-main-authenticated]` (shell-panels.tsx); balance rows `[data-balance-list] [data-kind="balance"]` (smoke.pw.ts); reveal window grows after scroll (`BALANCES_BATCH_SIZE = 10`, client/home/balances-panel.tsx); `Show small balances` switch lives in account settings, not this page (smoke.pw.ts touch test).
- **States**: loading shimmer (`LoadingMoneyGroup`, balances-panel.tsx); unavailable; empty (`BalancesEmpty`); ready with reveal batches; stale revalidation anchored to requested group (`cold and revalidated cached Balances…` smoke test).
- **Evidence**: screenshot; DOM snapshot; console/errors; perf marks and scroll-offset assertions.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Owned by**: `apps/web/client/home/balances-panel.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/client/balances/use-balances.ts`, `/api/balances`.
- **Unknowns**: none; incremental batches use an intersection sentinel rather than a reveal-more button, group navigation is labelled `More <group>`, and the empty state is `No money yet`.

### `activity`
- **Live**: read-only
- **Reach**:
  1. `goto "/activity"`
  2. `expect "Activity"`
- **Notes**: The verifier seeds the signed-in session and API fixtures. Add `/api/activity` fixture rows when exercising populated states; the Home Activity card is the interactive entry point.
- **Expect**: `Activity` heading (`#activity-title`, client/activity/activity-panel.tsx `DefaultActivityHeader`); empty state `No activity yet`; end marker `End of activity`; error `Try again` button; rows expose `View <direction> <symbol> transaction details` activation labels (activity-panel.tsx `TransferActivityRow`).
- **States**: loading shimmer (`ActivityPage`, client/home/activity-panel.tsx `ShimmerRows count={4}`); empty (`No activity yet`); error (`Try again`); success list; load-more error/cursor states (client/activity/use-activity.ts, not read in detail).
- **Evidence**: screenshot; DOM snapshot; console/errors; marks `shell:paint` (dashboard).
- **Owned by**: `apps/web/client/activity/`, `apps/web/client/home/activity-panel.tsx`, `/api/activity`, `/api/actions`.
- **Unknowns**: row value/date text remains fixture-dependent; pagination is labelled `Load more activity`, `Continue loading activity`, or `Retry more activity`.

### `save`
- **Live**: confirm
- **Reach**:
  1. `goto "/save?flow=save-deposit"`
  2. `expect "Deposit"`
- **Notes**: The smoke path also covers `/save?flow=save-withdraw`, closes via `Close deposit dialog` or Escape (`Close withdraw dialog`), and asserts focus returns to the `Deposit` or `Withdraw` opener.
- **Expect**: section `role="region"`/`aria-label="Save"` hosted variant (savings-experience.tsx); vault radiogroup `aria-label="Vault"`; `Nothing saved yet` empty; action buttons `Get started` (unfunded) / `Deposit` + `Withdraw` (funded) (savings-experience.tsx); dialog labels from `closeLabel={Close ${mode} dialog}` and `primaryLabel` `Continue` → `Deposit $X`/`Withdraw $X`/`Retry` (savings-actions.tsx lines ~251–350).
- **States**: cold loading (`data-shimmer="savings-hero"`, `savings-apy`); vaults loading `aria-busy`; vaults error `Vaults are temporarily unavailable.` + `Retry`; stale alerts `Saved balance stale…` / `Vault rates stale…`; deposit/withdraw amount → confirm → pending (`Waiting for your wallet…`) → error/failed.
- **Evidence**: screenshot; DOM snapshot; console/errors; marks `shell:paint`, and `action:first-interactive` when the Send boundary mounts (not Save-specific).
- **Owned by**: `apps/web/client/savings/`, `apps/web/server/actions/*`, `/api/savings/vaults`.
- **Unknowns**: none blocking; notices include `Updating…`, `Loading APY…`, `Loading vaults…`, and the amount dialog reports the formatted available balance.

### `borrow`
- **Live**: up-to-review
- **Reach**: Seed the signed-in state and borrow fixtures, go to `/borrow` or `/borrow/<marketId>`, then choose a `data-testid="borrow-market-card"` inside the `Borrow markets` list.
- **Verify**: manual
- **Notes**: No smoke fixture exists for `/api/borrow*`; see Gaps.
- **Expect**: heading `Borrow` (`#borrow-overview-title`, `#borrow-direct-title`, borrowing-experience.tsx); position actions including `Borrow`, `Supply`/`Withdraw collateral from Bitcoin position` (`aria-label`, line 539); `Back to Borrow`; `Market values are unavailable` + `Retry` error; collateral preview `data-testid="borrow-collateral-preview"`; action money modal title `Confirm`, footer `Confirm action`/`Retry`/`Back`/`Close` (lines ~712–782).
- **States**: loading/error via `overview.refetch()`/`detail.refetch()` buttons; amount → confirm → pending (`Waiting for your wallet…`, `#borrow-action-pending`) → error/failed.
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/borrowing/`, `apps/web/server/*` borrow modules, `/api/borrow`, `/api/borrow/markets/[marketId]`.
- **Unknowns**: no fixture-backed browser smoke state exists. Operation labels are `Add collateral`, `Borrow`, `Repay`, `Repay all`, `Withdraw collateral`, and `Close position`.

### `invest`
- **Live**: read-only
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
- **Reach** (smoke-verified):
  1. Seed the signed-in fixture and install API fixtures.
  2. `goto "/home"`
  3. `expect "Recognized Coin"`
  4. `click "Send"`
  5. `expect "Send"`
- **Notes**: The dialog is labelled by `send-title`.
  1. **amount**: type digits via keypad buttons named `0`–`9`, `Decimal point`, `Delete last digit` (`role="group" aria-label="Amount keypad"`, client/money-modal/amount.tsx:581–601); quick chips group `Quick amounts` (`$10`/`$25`/`Max` when priced, amount.tsx:508+). Primary `Continue` disabled until positive amount (`isPositiveDecimalAmount`).
  2. **destination**: step title stays `Send`; field label `To` (AddressField `id="send-recipient"`); primary `Continue` disabled until `isTransferRecipient` (send-dialog.tsx).
  3. **confirm**: dialog title becomes `Confirm` (send-dialog.tsx `modalTitle`); summary via `MoneyConfirmSummary` rows `To` (CopyableValue full address), `Asset`, `Network` = `Base` (send-dialog.tsx); primary button `Send $1.00` where amount is `MoneyTicker(confirmAmount)` — smoke clicks `getByRole("button", { name: "Send $1.00" })`; secondary `Back`.
  4. **pending**: `Waiting for your wallet…` status (send-dialog.tsx); close disabled.
  5. **error**: message + `Try again` (primary) and `Back`; the "ambiguous handle response retries without a second wallet dispatch" test asserts `Try again` then `Send $1.00` again and `sessionStorage["home:playwright-smoke:dispatch-count"] === "1"` (smoke.pw.ts).
  6. **success/status**: dialog closes; toast `Sent $1.00 to 0x2222…222222` (exact text, smoke.pw.ts; toast owned by client/home/action-toasts.tsx).
- **Expect**: prepared action via `POST /api/actions/prepare`; confirm/handle via `/api/actions/[id]/{confirm,handle}` (smoke fixtures); dialog uses `data-money-sheet` / `data-money-sheet-grabber` (client/money-modal/money-modal.tsx) and reduced-motion transitions are `0s` (`drawer becomes instant…` smoke test).
- **States**: asset picker (`aria-label="Asset"`, amount.tsx:443) with multiple assets; no catalog balance → `No catalog balance is available to send.`; rejected/unknown wallet results via `messageForError` (send-dialog.tsx).
- **Evidence**: screenshots per step; DOM snapshot per step (re-snapshot after every material DOM change per SKILL.md); console/errors; startup and first-action marks.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/money-modal/`, `apps/web/server/actions/` (prepare/confirm/handle/list), routes `apps/web/app/api/actions/**`.
- **Unknowns**: none blocking; exact `MoneyConfirmSummary` fee row for sends (sends show no fee row — wallet shows fee; fixture `warnings` say `Network fee shown by wallet.`).

### `cash-out` (Peer offramp inner steps)
- **Live**: up-to-review
- **Reach** (smoke-verified, `openPeerCashOutHandle`, smoke.pw.ts): 1) seed + `installApiFixtures`. 2) `Send` → digits `1` → `Continue`. 3) click `/Send to Zelle, Venmo, Cash App and more/` (CashoutItem, send-dialog.tsx). 4) click `Cash App` (payment-method button, payout step). 5) textbox `Cash App handle` (label `${selectedPlatform.label} handle`); attributes asserted: `autocomplete="off"`, `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`, `enterkeyhint="next"`, 16px font, ≥44px target. 6) `Continue` → textbox `Re-enter handle` (`enterkeyhint="done"`). 7) `Review` → confirm step.
- **Verify**: manual
- **Expect**: modal title `Cash out with Peer` (send-dialog.tsx `modalTitle`); confirm rows `Provider`, `Payout app`, `Payout handle`, `Approximate receive`, `Estimated delivery`, `Network` = `Base` (send-dialog.tsx confirm rows); disclaimer `The fiat amount and delivery time are approximate, not guaranteed.`; primary `Cash out $X`.
- **States**: providers not loaded → CashoutItem absent (requires `PEER_OFFRAMP` stub registered after `installApiFixtures` via `route.fallback`, smoke.pw.ts); recovery items `Withdraw <amount>` for active orders; `Recover a Peer cash-out` button when `recoveryEligible` (send-dialog.tsx).
- **Evidence**: screenshots; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `/api/funding/providers?direction=offramp`, `/api/funding/offramp/orders`.
- **Unknowns**: none blocking; server cashout error copy depends on `serverCashoutMessage` (send-dialog.tsx).

### `add-money` (funding)
- **Live**: up-to-review
- **Reach** (smoke-verified IDRX path): 1) seed country `ID` (`localStorage["home.country.v1"]="ID"`) + `installApiFixtures`. 2) `signIn(page)` helper. 3) click `Add money` (funding-actions.tsx). 4) method step button `/Deposit IDR/` must contain `IDRX · Bank transfer · Mandiri` (smoke.pw.ts). 5) type `20000` via numpad. 6) `Review quote` → heading `Review quote`, row `Receive` contains `20.000,00 IDRX`. 7) `Confirm deposit` → heading `Review payment details`, row `Network` contains `Rp 100,00`. 8) `View payment instructions` → `123456789012` visible; then `Money received` (≤7s budget, smoke.pw.ts).
- **Verify**: manual
- **Expect**: dialog titles `Add money` / `Receive` / `Deposit IDR` (add-money-dialog.tsx `title`); method list has `Receive crypto` row; close label `Close add money`; receive step QR (`aria-label="QR code for Base address …"`) and address copy (`Copy …`, `Full Base address …`, add-money-dialog.tsx). Signed-out body offers `Sign in` link to `/?account=signin`.
- **States**: method loading (`providerBindingsDisabled={!ordersQuery.isSuccess}`); `Funding methods are unavailable. Try again.` / `Home couldn't check for an open deposit. Retry.` / `Home couldn't check your provider setup. Retry.` (funding-experience.tsx); resumable open order auto-jumps to `order` step (funding-experience.tsx); customer/KYC step for providers with `customerSetup`.
- **Evidence**: screenshots per step; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/funding/{funding-actions,funding-experience,add-money-dialog,order-flow,receive-qr}.tsx`, `/api/funding/*`.
- **Unknowns**: provider-specific order-flow labels outside the smoke-verified IDRX path remain unknown because they depend on provider configuration; snapshot before acting.

### `account-settings`
- **Live**: read-only
- **Reach**:
  1. `goto "/home?account=settings"`
  2. `expect "Account"`
- **Notes**: The verifier seeds the signed-in session and fixtures. The interactive path clicks the header profile mark; `Done` closes the settings panel.
- **Expect**: `Show small balances` switch (`getByRole("switch", { name: "Show small balances" })`, smoke.pw.ts wide-touch test; owned by client/home/use-show-small-balances.ts + account-settings region of shell-panels.tsx). Sign-out control and region selector live here (shell-panels.tsx passes `regionId`, `resolutionSource`, `onRegionChange`, `onSignOut` to client/account/account-settings.tsx).
- **States**: preference not ready (`isPreferenceReady`); region override messages (`preferenceMessage`).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/account/account-settings.tsx`, `apps/web/client/home/shell-panels.tsx`.
- **Unknowns**: none; the country selector is described by `Country` / `Sets how money is shown`, and the button is labelled `Sign out`.

### `access-gate`
- **Live**: read-only
- **Reach** (smoke-verified): 1) clear cookies; goto `/home` (protected) → redirect `/access?next=%2Fhome`. 2) fill textbox `Access password`; wrong value → `Access denied. Try again.`; cookie `home-access` absent. 3) correct `HOME_ACCESS_PASSWORD` → `Continue` posts `/api/access`, then URL `/home` or `/?account=signin`. 4) heading `Access granted` on revisit; `Leave this deployment` posts `/api/access/logout` (no-JS form also asserted).
- **Verify**: manual
- **Expect**: headings `Enter access password` / `Access granted`; `Continue to Home` link; CSP header `frame-ancestors 'none'` on the protected response (tests/browser/access.pw.ts); hydrated form marker `form[data-hydrated="true"]`.
- **States**: `misconfigured` → `Access is temporarily unavailable.`; `disabled` → `Continue to Home` (app/access/page.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/access/page.tsx`, `apps/web/server/access/*`, `/api/access`.
- **Unknowns**: cookie/secret names intentional; do not print credentials.

### `coverage`
- **Live**: read-only
- **Reach**:
  1. `goto "/coverage"`
  2. `expect "Local money coverage"`
- **Notes**: Exercise the four native comboboxes for search, issuer, Home status, and priority plus the `sort` query parameter when validating filters.
- **Expect**: `Local money coverage | Home` title; coverage table rows (components/ui/coverage-table.tsx); combobox font ≥16px on mobile/landscape (tests/browser/smoke.pw.ts).
- **States**: filtered-empty result reports `Showing 0 of <total> countries and territories.` and an empty coverage table.
- **Evidence**: screenshot (390×844 and 844×390); DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/coverage/page.tsx`, `apps/web/client/coverage/`, `apps/web/config/coverage.ts`.
- **Unknowns**: none; filters are `Search`, `1:1 onramp`, `Portfolio`, `Integrated`, and `Sort`.

### `dev-ui`
- **Live**: read-only
- **Reach**: Run with `HOME_PLAYWRIGHT_SMOKE=1` or in development, go to `/dev/ui`, and otherwise expect `notFound()` (404).
- **Verify**: manual
- **Expect**: `Home UI theme` heading; swatch grid; `Stock type scale` card; `Buttons` section with `Primary`/`Outline`/`Destructive` (app/dev/ui/page.tsx).
- **States**: enabled vs 404.
- **Evidence**: screenshot; DOM snapshot.
- **Owned by**: `apps/web/app/dev/ui/page.tsx`.
- **Unknowns**: none.

### `toasts`
- **Live**: read-only
- **Reach**: Complete a prepared action (smoke: send success) and observe the toast region.
- **Verify**: manual
- **Expect**: exact success copy e.g. `Sent $1.00 to 0x2222…222222` (smoke.pw.ts); renders only when `routeMode === "dashboard" && isVerified` (shell.tsx).
- **States**: pending/confirmed/failed toast variants (client/home/action-toasts.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/home/action-toasts.tsx`, `/api/actions`.
- **Unknowns**: none; pending/confirmed verbs are defined for savings and Borrow operations, and failures use `<Action> failed: <reason>`.

## Gaps

**No Playwright coverage and no journey story** (checked `apps/web/tests/browser/` and `apps/web/stories/journeys/`, which contains only `savings-deposit.stories.tsx`):
- `borrow` (no smoke fixture for `/api/borrow*` at all), `activity`, `account-settings`, `invest` hub/category browsing beyond one asset-detail click, `dev-ui`, `coverage` filtering behavior (only font metrics asserted).
- Journey stories: only `apps/web/stories/journeys/savings-deposit.stories.tsx` exists; every other surface above lacks one.

**Reach depends on a live provider and cannot run against the fixture server** (needs a documented fixture or is operator-only):
- Base-account/CDP sign-in (`client/account/base-account-connector.tsx`, `cdp-*`), real Coinbase onramp/offramp providers via `/api/funding/providers`, `/api/funding/quotes`, `/api/funding/provider-customers`, and `/api/funding/webhooks/[provider]` (smoke uses hand-written IDRX/PEER stubs instead of a documented shared fixture).
- Invest `Memes` discovery (`/api/invest/discover`) and market prices (`/api/market-prices*`) when the fixture returns `{}` — smoke never asserts a meme shelf; treat as unknown rather than "empty".
- `/api/webhooks/cdp` and trades (`/api/trades`, `client/trading/trade-actions.tsx` buttons are `disabled` — trading is not user-reachable today).

**Initial perf budgets**: the CLI budgets are deliberately broader than local smoke timing and apply only when listed on a surface. They establish a measured baseline for `shell:paint`, `session:verified`, and `action:first-interactive`; the existing smoke budget for `balances:painted` is unchanged.

**Verification notes:** every selector quoted here was read from code or from `tests/browser/smoke.pw.ts`. Remaining Unknowns identify provider- or fixture-dependent behavior that code alone cannot confirm. The fixture baseline and kept-current trigger set are repository policy.
