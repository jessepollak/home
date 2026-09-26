### `borrow`
- **Entry context**: borrowing · `/borrow`, `/borrow/<marketId>` · same · session + borrow market fixtures · Home `Your money` Borrow Cash row (home-overview.tsx), goto path.

- **Live**: confirm
- **Owned paths**: `apps/web/app/borrow/**`, `apps/web/client/borrowing/**`, `apps/web/app/api/borrow/**`, `apps/web/server/borrowing/**`, `apps/web/server/morpho-markets/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`
- **Confirm labels**: "Confirm action", "Retry"
- **Reach**: Seed the signed-in state and borrow fixtures, go to `/borrow` or `/borrow/<marketId>`, then choose a `data-testid="borrow-market-card"` inside the `Borrow markets` list.
- **Reach (live)**:
  1. `goto "/borrow/0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836"`
  2. `expect "Borrow"`
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
  5. `click "Continue"`
  6. `expect "Confirm"`
- **Reach (live, Repay all up to review)**: Requires a nonzero debt position and wallet USDC; if there is no debt/`Repay` affordance, stop and report the prerequisite, do not manufacture debt. From the market detail, click `Repay`, select `Max` (the amount step shows `Maximum repayment`), click `Continue`, then read the full `Confirm` review. `Max` with insufficient wallet USDC can be a partial repayment; stop unless the review explicitly says `Repay all USDC debt`. Expect `Repay all USDC debt`, Base, and a maximum ≤ borrowed amount + 0.0002 USDC (accrued debt need not equal $0.10).
- **Confirm (live, authorization-gated)**: After matching the review `From` row to the account anchor and verifying the other review facts, check `data-money-action-id` on `Confirm action` and click it once only under Rung 3 or Jesse's direct authorization. Borrow expects `Borrowed $0.10`; repay-all expects `Repaid all Borrow debt` and no remaining debt/Repay affordance. Never reuse a previously stopped prepared action.
- **Verify**: manual
- **Notes**: The shared fixture routes serve `/api/borrow` (overview v2, five registry markets, an open cbETH position) and each `/api/borrow/markets/<id>`; `/api/actions/prepare` is not fixture-backed. Live: the `1` chip renders only when the pinned account holds the market's collateral (`You need <collateral symbol> in this wallet before you can borrow.`). On 2026-09-22 the bot had no cbBTC, so the `1` chip was unavailable. On 2026-09-24 it held cbBTC and reached a $0.10 review; read a fresh position snapshot before acting because collateral and debt change.
- **Expect**: heading `Borrow` (`#borrow-overview-title`, `#borrow-direct-title`, borrowing-experience.tsx); one card per registry market headed by its collateral display name (Bitcoin, XRP, Staked ETH, Dogecoin, Cardano); position actions including `Borrow`, `Add collateral`/`Withdraw collateral from <display name> position` (`aria-label`); `Back to Borrow`; `Market values are unavailable` + `Retry` error; collateral preview `data-testid="borrow-collateral-preview"`; action money modal title `Confirm`, footer `Confirm action`/`Retry`/`Back`/`Close` (borrow-money-dialog.tsx); prepared Borrow, Repay and collateral review rows start with `From` (short address from the prepared action's owner), followed by movement, variable rate, network and Network fee (when paid in USDC).
- **States**: loading/error via `overview.refetch()`/`detail.refetch()` buttons; amount → confirm → submitting (busy `Confirm action`) → result (`Borrowing 1 USDC` pending steps, `Borrowed 1 USDC`, `Borrow didn't go through` + `Try again`, or `We can't confirm 1 USDC` + `View in Activity`, no retry); rejection stays on the review.
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/borrowing/`, `apps/web/server/*` borrow modules, `/api/borrow`, `/api/borrow/markets/[marketId]`.
- **Unknowns**: prepare/confirm are not fixture-backed, so review and pending states need unit tests or a live session. Operation labels are `Add collateral`, `Borrow`, `Repay`, `Repay all`, `Withdraw collateral`, and `Close position`.
