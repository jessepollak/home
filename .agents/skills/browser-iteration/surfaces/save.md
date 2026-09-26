### `save`
- **Entry context**: savings · `/save`, `?flow=save-deposit`, `?flow=save-withdraw` · same · `HOME_PLAYWRIGHT_SMOKE=1`; `/api/savings/vaults` fixture present in tests/browser/fixtures/api.ts `installApiFixtures` · Home `Your money` Cash row (home-overview.tsx), goto `/save?flow=save-deposit`.

- **Live**: confirm
- **Owned paths**: `apps/web/app/save/**`, `apps/web/client/savings/**`, `apps/web/shared/savings/**`, `apps/web/app/api/savings/**`, `apps/web/server/savings/**`, `apps/web/server/morpho/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`
- **Confirm labels**: "Deposit $<amount>", "Withdraw $<amount>", "Retry"
- **Reach**:
  1. `goto "/save?flow=save-deposit"`
  2. `expect "Deposit"`
- **Reach (live)**:
  1. `goto "/save?flow=save-deposit"`
  2. `expect "Deposit"`
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
  5. `click "Continue"`
  6. `expect "Confirm"`
- **Confirm (live, authorization-gated)**: After matching the review `From` row to the account anchor and verifying the other review facts, check `data-money-action-id` on `Deposit $0.10` and, only with Rung 3 or Jesse's direct authorization, click once and expect `Deposited $0.10`. For a funded withdrawal, choose `Withdraw`, use Max for available savings, reach review, then apply the same gate to the marked `Withdraw $<amount>` control.
- **Notes**: On an unfunded Save landing with loaded vault metadata and a selected vault, the `Start saving` FeatureIntro has a single `Get started` that opens Deposit (not a separate bottom `Deposit`); the deep-linked deposit still works. The intro is absent while vault metadata loads or if the loaded candidate list is empty. The smoke path dismisses it with Close and browser Back; it also opens Deposit and Withdraw from their buttons, closes via Close or Escape, and asserts focus returns to the exact opener.
- **Expect**: section `role="region"`/`aria-label="Save"` hosted variant (savings-experience.tsx); vault radiogroup `aria-label="Vault"`; unfunded `Start saving` FeatureIntro with one `Get started` opening Deposit / funded `Deposit` + `Withdraw` buttons (savings-experience.tsx); dialog labels from `closeLabel={Close ${mode} dialog}` and `primaryLabel` `Continue` → `Deposit $X`/`Withdraw $X`/`Retry` (savings-actions.tsx lines ~251–350); deposit and withdrawal review rows start with `From` (short address from the prepared action's owner), followed by vault, network, APY, fee, amount, share preview, exchange constraint and validity, then Network fee (when paid in USDC).
- **States**: cold loading (`data-shimmer="savings-hero"`, `savings-apy`); vaults loading `aria-busy` with no intro; empty candidate list with no intro or vault options; vaults error `Vaults are temporarily unavailable.` + `Retry`; saved-balance alert `Saved balance stale…`; expired vault rates retain numeric APY without an APY stale notice; deposit/withdraw amount → confirm → submitting (the confirm primary keeps its label and focus with `aria-busy` and a spinner) → result (`ResultHeader`: `Depositing $25.00 to Save` with `Submitted` / `Confirming on Base` steps, `Deposited $25.00 to Save`, `Deposit didn't go through` + `Try again`, or `We can't confirm $25.00` + `View in Activity` and no retry); a rejection stays on the review with its alert.
- **Evidence**: screenshot; DOM snapshot; console/errors; marks `shell:paint`, and `action:first-interactive` when the Send boundary mounts (not Save-specific).
- **Owned by**: `apps/web/client/savings/`, `apps/web/server/actions/*`, `/api/savings/vaults`.
- **Unknowns**: none blocking; notices include `Updating…`, `Loading APY…`, `Loading vaults…`, and the amount dialog reports the formatted available balance.
