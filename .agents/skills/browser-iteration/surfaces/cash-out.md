### `cash-out` (Peer offramp and Activity)
- **Entry context**: transfers/funding/activity · `?flow=cash-out` overlay on any shell route, then USDC amount → method → handle → review; pending item on `/home` or `/activity` · signed-in, region with offramp provider · PEER_OFFRAMP stub and `openPeerCashOutHandle` in mobile-geometry.pw.ts; waiting Activity item and dynamic Cancel prepare fixture in cash-out-cancel.pw.ts · always-present `Cash out` trigger, separate from `Send`. No address field or recent recipients appear in Cash out. Legacy `flow=send&action=<id>` cash-out reviews still resume, then canonicalize to `flow=cash-out&action=<id>`. Cash-out entry rejects send-action resumes. Activity → pending item → details → `Cancel cash-out $X` → withdrawal review remains a step of that same detail sheet.

- **Live**: confirm
- **Owned paths**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/activity/**`, `apps/web/server/actions/**`, `apps/web/server/funding/**`
- **Confirm labels**: "Cash out $<amount>", "Withdraw $<amount>"
- **Reach**:
  1. `goto "/home"`
  2. `click "Cash out"`
  3. `fill "Amount" "1"`
  4. `click "Continue"`
  5. `click-prefix "Available payout apps: Cash App"`
  6. `fill "Cash App cashtag" "$fixture-payee"`
  7. `click "Review"`
  8. `expect "Payout destination"`
- **Reach (replay: withdrawal-recovery)**:
  1. `goto "/home"`
  2. `click-prefix "Cash out to Cash App"`
  3. `expect "Waiting for a buyer"`
  4. `click "Cancel cash-out $50"`
  5. `expect "Confirm withdrawal"`
- **Fixture notes**: The entry Reach requires an offramp provider and cash-out prepare override; the default agent-browser fixture deliberately returns an empty provider list. Use `cashoutFixtureProviders`, `cashoutFixturePrepared`, and `cashoutFixtureResume` from `tests/browser/feature-map/cashout-fixture.ts`, scaling the synthetic prepare amount/quote to the entered amount. `cash-out-entry.pw.ts` uses a $100 balance and $50 review and covers reload and Close → Forward without reprepare or dispatch, legacy URL canonicalization, unknown/wrong-owner reviews and availability states with Send offered. Send-off unsupported copy is story-covered (`CashOutUnsupportedWithoutSend`); Send-off shell and legacy-link integration is not browser-verified. `cash-out-cancel.pw.ts` keeps Activity recovery in the detail sheet; use `cashoutFixtureWithdraw` only for its Cancel prepare. Routine verification never presses the marked Cash out or Withdraw control. Cash-out geometry at 390/320px and landscape remains in mobile-geometry.pw.ts.
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Cash out"`
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
  5. `click "Continue"`
  6. Choose the Cash App method row (the payout mark contributes `Available payout apps: Cash App`; every eligible binding's methods appear separately).
  7. Expect the handle field; Back returns to methods, then to amount.
  8. Fill `Cash App cashtag` with the pinned `HOME_VERIFY_CASHOUT_HANDLE` (never fixture `$alice`). Never send raw handle-step snapshots to logs.
  9. `click "Review"` (no re-entry step).
  10. Read the payout destination callout, `You receive`, `Arrives`, and `Confirm`; compare the canonical destination against the pinned value **inside the shell** and redact both canonical and `$`-prefixed forms before any snapshot output. The `From` row is under `Details`. `Edit Cash App cashtag` returns to the entry field and requires a new review.
- **Confirm (live, authorization-gated)**: Check `data-money-action-id` on `Cash out $0.10` and click once only under Rung 3 or Jesse's direct authorization, after review facts and the `From` row match the account anchor.
- **Withdrawal recovery (live, up to review)**: In-flight Peer cash-outs appear in Activity. Open the **unique** authorized pending item, select `Cancel cash-out $X` in details, and check its amount, network Base, and the withdrawal review `From` row against the account anchor. It returns funds to the owner; its withdrawal review has **no destination callout** and is a step of that same detail sheet rather than the Send sheet. No matching in-flight item means stop; do not manufacture one.
- **Recovery confirm (live, authorization-gated)**: Check `data-money-action-id` on `Withdraw $<amount>` and click once only under Rung 3 or Jesse's direct authorization after the order, amount, Base and `From` row checks against the account anchor.
- **Verify**: manual
- **Expect**: modal title `Cash out with Peer` during entry (send-dialog.tsx `modalTitle`); deposit review is the shared `CashOutReview` (client/money-modal/cash-out-review.tsx) with a `Payout destination` callout (payout app, canonical destination, Edit) between the lead and rows card. Rows in order: `You send`, `Peer fee` (`None`, an amount, or `Not quoted`), `Network fee` when the action pays one in USDC, `Service fee` only once an operator fee exists, `Rate` only when a conversion happens, `You receive` (`≈ $X to Cash App`), `Arrives` (`Usually within …` or `Arrival time varies`). `Details` holds `From` (short address from the prepared action's owner), `Provider`, `Network` = `Base`. A one-line estimate note appears only when the receive amount or arrival is an estimate. Withdrawal review keeps its `From`, `Provider`, `Payout app`, `Network` rows and no callout; from Activity it replaces the details content inside the open detail sheet under title `Confirm withdrawal` and its `Back` returns to the details step. Primary `Cash out $X` or `Withdraw $X` renders reviewed USDC in dollars (`formatUsdStablecoinAmount`). When the deposit review expires (client clock or `ACTION_EXPIRED` on confirm), the review stays, says `This quote expired. Get a new quote to continue.`, and the unmarked primary is `Get new quote`; the new review shows `The quote changed. Check what you receive before you cash out.` when the receive amount moved, and the customer presses `Cash out $X` again. Activity cash-out details show the reviewed quote as `You receive` with `Arrives` while a buyer can still pay, and as `Quoted receive` without `Arrives` once the cash-out is returning, returned, paid, failed or unconfirmed.
- **States**: Cash out always has its own trigger; Send off leaves Add money and Cash out evenly filling the Home row. Cash out locks the asset picker to USDC and never renders wallet recipients. Before amount: region/query pending → `Checking cash-out options…` with `aria-busy`, no Continue or unavailable claim; failed/malformed/null read → `Cash out is unavailable right now.` with `Retry` (disabled during refetch, error copy retained); valid empty/no eligible Base USDC binding → `Cash out to <currency name> isn't available yet` plus `You can still send USDC to any wallet.` Only when Send is offered, `Send USDC` switches entry and replaces the URL with `flow=send`, without preparing or dispatching. Available → amount → every eligible provider's method rows → handle → existing review. Back from handle returns to methods; Back from methods returns to amount. Pending Activity items show the last observed provider state and offer `Cancel cash-out $X` only when withdrawal is available; Send never offers payout or order recovery.
- **Paused corridor or removed region at confirmation**: a cash-out prepared before its corridor was paused, or its region removed, is refused when the customer confirms it, and the sheet returns to the first step with `This review is no longer available — start again.` Unreadable settings fail the same way. A cash-out the owner already confirmed still withdraws, and recovery never reads the setting.
- **Evidence**: screenshots; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/activity/`, `/api/funding/providers?direction=offramp`, `/api/actions`.
- **Unknowns**: none blocking; server cashout error copy depends on `serverCashoutMessage` (send-dialog.tsx).
