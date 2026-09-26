### `cash-out` (Peer offramp inner steps)
- **Entry context**: transfers/funding · inner steps of `send`: payout/handle/handle-confirm · signed-in, region with offramp provider · PEER_OFFRAMP stub and `openPeerCashOutHandle` in mobile-geometry.pw.ts · `Send` → amount → `Continue` → `Send to Cash App or Zelle` (US; send-dialog.tsx `CashoutItem`). Where no offramp binding exists, the destination step shows the country's unavailable status.

- **Live**: confirm
- **Owned paths**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/app/api/funding/offramp/**`, `apps/web/server/funding/offramp/**`
- **Confirm labels**: "Cash out $<amount>", "Withdraw $<amount>"
- **Reach** (smoke-verified through re-entry, `openPeerCashOutHandle`, mobile-geometry.pw.ts): 1) seed + `installApiFixtures`. 2) `Send` → type `1` into `Amount` → `Continue`. 3) click `/Send to Cash App/` (CashoutItem, send-dialog.tsx; the fixture binds only Cash App). 4) click `Cash App` (payment-method button, payout step). 5) textbox `Cash App handle` (label `${selectedPlatform.label} handle`); smoke asserts 16px font and ≥44px portrait target. 6) fill `$alice`, click `Continue` → visible textbox `Re-enter handle`; smoke asserts 16px font and ≥44px portrait target. Input hints (`autocomplete`, `autocapitalize`, `autocorrect`, `spellcheck`, `enterkeyhint`) and `Review` → confirm behavior are asserted in client/transfers/send-dialog.test.tsx, not browser smoke.
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Send"`
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
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
