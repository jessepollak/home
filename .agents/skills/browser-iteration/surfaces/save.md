### `save`
- **Entry context**: Cash overview `/cash`, Savings detail `/cash/savings`, deep links `/cash/savings?flow=save-deposit` and `?flow=save-withdraw`; legacy `/save` redirects to `/cash/savings`, preserving allowlisted overlays. Fixture `HOME_PLAYWRIGHT_SMOKE=1` with `/api/savings/vaults` in `tests/browser/feature-map/fixtures.ts` and Playwright's `installApiFixtures`.
- **Live**: confirm
- **Owned paths**: `apps/web/app/[...shell]/**`, `apps/web/client/cash/**`, `apps/web/client/savings/**`, `apps/web/shared/savings/**`, `apps/web/app/api/savings/**`, `apps/web/server/savings/**`, `apps/web/server/morpho/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`
- **Confirm labels**: "Deposit $<amount>", "Withdraw $<amount>", "Retry"
- **Reach**:
  1. `goto "/cash/savings?flow=save-deposit"`
  2. `expect "Deposit"`
- **Reach (live)**:
  1. `goto "/cash/savings?flow=save-deposit"`
  2. `expect "Deposit"`
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
  5. `click "Continue"`
  6. `expect "Confirm"`
- **Confirm (live, authorization-gated)**: Compare the prepared action's full `From` address with the approved account anchor before the marked control. Check vault, amount, network, exchange constraint, fee, and validity. Only with Rung 3 or Jesse's direct authorization click the marked `Deposit $0.10` once and inspect the result. Withdraw uses the same gate and the chosen held vault.
- **Notes**: Home's Cash row opens `/cash`; its Savings row opens `/cash/savings`. In-app Back from Savings returns to Cash, restoring focus to the Savings row; direct-link Back replaces with Cash. Back from Cash returns Home. Browser history and refresh preserve view and valid flow. Deposit sheet Close restores the opener's focus. A legacy `/save?flow=save-deposit` redirect opens the Savings detail and Deposit sheet.
- **Expect**: nested chrome and navigation-panel label `Cash` on `/cash`, `Savings` on `/cash/savings`; Cash balance headline, `Currencies` and `Savings` rows in the overview (`cash-overview.tsx`), Savings balance and held/available vault rows in detail, Deposit and Withdraw actions, withdrawal chooser for multiple held vaults. Dialog `Deposit` / `Withdraw` is in `savings-actions.tsx`; review includes prepared action `From`, vault, network, APY, fee, amount, share preview, exchange constraint and validity.
- **States**: overview balance loading or failed, rates loading or failed, partial/unpriced holdings, empty cash; Savings detail no held vault, rate failures, stale rates, multiple held vault chooser, deposit or withdrawal flow; dialogs include amount, confirm, submitting, confirmed, failed, and recovery. A failed balance or unavailable vault disables unsafe sheet entry while keeping a pending confirmed action visible.
- **Evidence**: screenshot; DOM snapshot; console/errors; shell paint mark.
- **Owned by**: `apps/web/client/cash/`, `apps/web/client/savings/savings-actions.tsx`, `/api/savings/vaults`.
- **Unknowns**: no provider or funded confirmation is established by fixture replay.
