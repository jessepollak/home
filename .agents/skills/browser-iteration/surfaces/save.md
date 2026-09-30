### `save`
- **Entry context**: Cash overview `/cash`, Savings detail `/cash/savings`, deep links `/cash/savings?flow=save-deposit` and `?flow=save-withdraw`; legacy `/save` redirects to `/cash/savings`, preserving allowlisted overlays. Fixture `HOME_PLAYWRIGHT_SMOKE=1` with `/api/savings/vaults` in `tests/browser/feature-map/fixtures.ts` and Playwright's `installApiFixtures`.
- **Live**: confirm
- **Owned paths**: `apps/web/app/(shell)/**`, `apps/web/app/save/**`, `apps/web/client/cash/**`, `apps/web/client/savings/**`, `apps/web/client/trading/**`, `apps/web/shared/savings/**`, `apps/web/shared/trading/**`, `apps/web/app/api/savings/**`, `apps/web/server/savings/**`, `apps/web/server/morpho/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`
- **Confirm labels**: "Deposit $<amount>", "Withdraw $<amount>", "Convert $<amount>", "Retry"
- **Reach**:
  1. `goto "/cash/savings?flow=save-deposit"`
  2. `expect "Deposit"`; in-app entry from `/cash/savings` opens a `Manage <vault>` row, then `Deposit more`. On a verified-empty account start from the intro: Start saving opens the vault picker, and picking a vault opens the amount step.
  3. `fill "Amount" "0.1"`, click `Continue`, expect `Confirm`. With no eligible cash the picker offers Add money instead of a selectable vault.
- **Reach (replay: convert)**: fixture Convert from USD to EUR, stopping at the review before the marked control.
  1. `goto "/cash"`
  2. `click "Convert"`
  3. `expect "Convert to"`
  4. `click-prefix "Euro"`
  5. `fill "Amount" "1.25"`
  6. `expect "available"`
  7. `click "Continue"`
  8. `expect "Convert USD to EUR"`
  9. `expect "You pay"`
  10. `expect "$1.25"`
  11. `expect "You receive"`
  12. `expect "Rate"`
  13. `click "Details"`
  14. `expect "Minimum received"`
  15. `expect "€1.98"`
  16. `expect "Max slippage"`
  17. `expect "1%"`
  18. `expect "Network"`
  19. `expect "From"`
  20. `expect "Convert $1.25"`
- **Reach (live)**:
  1. Funded: `goto "/cash/savings?flow=save-deposit"`, or open a `Manage <vault>` row and click `Deposit more`; `expect "Deposit"`.
  2. First use on a verified-empty Savings detail: click `Start saving`, `expect "Choose where to save"`, pick a vault, then `expect "Deposit"`.
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
  5. `click "Continue"`
  6. `expect "Confirm"`
- **Reach (live, Convert up to review)**: requires a USD cash balance and an available destination; if `Convert` is disabled or no destination row is enabled, stop and report the prerequisite or `no route`, never pick a substitute currency.
  1. `goto "/cash"`
  2. `click "Convert"`
  3. `expect "Convert to"`
  4. `click-prefix "Euro"`
  5. `fill "Amount" "0.1"`
  6. `expect "available"`
  7. `click "Continue"`
  8. `expect "Convert USD to EUR"`
  9. `click "Details"`
  10. `expect "Max slippage"`
  11. `expect "1%"`
  Read the full-text review and check: lead `Convert USD to EUR`; `You pay` $0.10; `You receive` an approximate EUR amount; `Rate` present; `Minimum received` in EUR, not above the estimate and at least 99% of it; `Max slippage` exactly `1%`; `Quote expires in` counting down; `Network` Base; `EURC contract` matches the canonical EURC address; the full `From` address passes `live-login --check-account`. A service fee, when charged, appears as its own row and explains the difference between the quoted swap rate and the cash amounts the customer pays and receives. Stop at the marked `Convert $0.10` control unless the change itself puts this surface under the ladder's Rung 3 row: this surface maps no Convert confirm of its own, so a press needs that row's authorization, a review amount and destination matched to the task, and a passing `live-login --check-account` on the review `From` row first.
- **Confirm (live, authorization-gated)**: Compare the prepared action's full `From` address with the approved account anchor before the marked control. Check vault, amount, network, rate, vault fee, and validity (withdrawals also show the exchange constraint). Only with Rung 3 or Jesse's direct authorization click the marked `Deposit $0.10` once and inspect the result. Withdraw uses the same gate and the chosen held vault.
- **Notes**: Home's Cash row opens `/cash`; Cash shows Add money and Convert side by side, and its Savings row opens `/cash/savings`. Convert opens a destination picker for EUR/IDR, then amount and prepared review in one sheet; currency rows open detail with Convert and USD-only Save when a vault and USDC balance are ready. EUR/IDR rows convert only to USD. Each destination's trade availability controls activation; an unavailable destination is not clickable, zero USD shows Add money, quote failures and expiry offer recovery. X closes the entire journey, Back moves one step, and closing an unresolved execution reopens at Retry for the same action. The shared fixture serves synthetic `/api/trades` availability for EUR/IDR so the picker and amount are reachable; its generic prepare route still returns a Send action, so the replayed `Reach (replay: convert)` and the Cash Playwright spec route a synthetic trade prepare (`tests/browser/feature-map/conversion-fixture.ts`) to reach conversion review. Neither fixture proves live provider routing. In-app Back from Savings returns to Cash, restoring focus to the Savings row; direct-link Back replaces with Cash. Back from Cash returns Home. Browser history and refresh preserve view and valid flow. Deposit sheet Close restores the opener's focus. A legacy `/save?flow=save-deposit` redirect opens the Savings detail and Deposit sheet.
- **Expect**: nested chrome and navigation-panel label `Cash` on `/cash`, `Savings` on `/cash/savings`; Cash balance headline (wallet-only; a muted `Pending cash-out · $X` line `[data-pending-cash-out]` sits under it while an unsettled Peer cash-out still holds escrow; an indeterminate pending cash-out shows `Pending cash-out · —` without a number and keeps the hero Cash amount wallet-only), `Currencies` and `Savings` rows in the overview (`cash-overview.tsx`) with Add money and Convert above them and each held cash currency row opening its detail (Convert, plus USD-only Save when a vault and USDC balance are ready), Savings detail shows only a first-use intro when verified empty: Start saving opens the Choose where to save modal picker (all supported vaults, best rate first). Pick a vault to enter an amount; Back returns to the picker, and Close restores focus to Start saving. Without cash, the picker lists rates but disables vault selection and offers Add money; closing Add money returns to Savings without resuming a deposit. An unreadable cash balance keeps the picker unresolved: rates stay visible, selection stays disabled, and the picker says the cash balance couldn't be checked with a Retry instead of offering Add money. Funded detail retains Savings balance, tappable `Your savings` rows and the per-position management tray with `Deposit more` / `Withdraw`, and `More ways to save` rows for new positions. Dialog `Deposit` / `Withdraw` is in `savings-actions.tsx`; review includes prepared action `From`, vault, network, rate, vault fee, amount, the withdrawal exchange constraint and validity.
- **States**: overview balance loading or failed, rates loading or failed, partial/unpriced holdings, empty cash, priced or indeterminate pending cash-out; Cash Convert picker loading/error/unavailable/zero, amount, review, no-route, expired quote, attempted-execution recovery; Savings detail verified empty, no-cash, unreadable-cash (unresolved picker with Retry, never Add money), no-opportunity, loading/stale/partial without intro, pending first deposit shows its amount in the Savings balance and a non-activatable Pending row in Your savings only while the balance snapshot verifies complete emptiness (including after reload via recent actions, even for a confirmed deposit whose receipt is not yet known to predate the snapshot block) until funded; unreadable or failed balances retain their unavailable states; a failed action returns to the intro with a retry warning; recent actions loading holds the intro, and an unresolved recent-actions error shows a "Couldn't check your deposits" retry instead of the intro so first use can't bypass a possibly pending deposit; an in-flight deposit whose stored amounts can't be displayed shows that same retry instead of Start saving and never enters the deposit flow; a locally tracked unresolved first deposit disables the other deposit entries and closes any reopened deposit flow until its server row settles (confirmed with a receipt older than a complete snapshot) or the portfolio funds; every unfunded deposit entry — Start saving, a `?flow=save-deposit` link, a More ways row, or Save on the Cash US dollar row — arms a post-entry history read, keeps Prepare/Confirm disabled until it lands and while another in-flight or unverifiable deposit exists, and records a deposit submitted from any of them as an owner-scoped pending first deposit until that row settles; an empty entry refreshes its action history on focus, on reconnect, and every 15s while visible so another tab's deposit can't be bypassed; rate failures, stale rates, single held position, multiple held positions, paused deposits with withdrawal allowed, unavailable metadata, unreadable balance, zero vault liquidity, new opportunity, deposit or withdrawal flow; dialogs include amount, confirm, submitting, confirmed, failed, and recovery. A failed balance or unavailable vault disables unsafe sheet entry while keeping a pending confirmed action visible.
- **Evidence**: screenshot; DOM snapshot; console/errors; shell paint mark.
- **Owned by**: `apps/web/client/cash/`, `apps/web/client/savings/savings-actions.tsx`, `/api/savings/vaults`.
- **Unknowns**: no provider or funded confirmation is established by fixture replay.
