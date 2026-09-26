### `send` (money modal — steps individually)
- **Entry context**: transfers/money-modal · overlay on any shell route: `?flow=send` · signed-in (button disabled pre-boundary, transfer-actions.tsx) · signed-in seed + `/api/actions/prepare`, `[id]` pending-review, `/api/transfers/recipient-name`, `/api/transfers/recent-recipients` fixtures (confirmation is not part of routine verification) · `Send` button, `data-action-trigger` (transfer-actions.tsx).

- **Live**: confirm
- **Owned paths**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/money-modal/**`, `apps/web/shared/transfers/**`, `apps/web/app/api/actions/**`, `apps/web/app/api/transfers/**`, `apps/web/server/actions/**`, `apps/web/server/money-actions/**`, `apps/web/server/transfers/**`
- **Confirm labels**: "Send $<amount>"
- **Reach** (smoke-verified):
  1. Seed the signed-in fixture and install API fixtures.
  2. `goto "/home"`
  3. `expect "Borrow Cash"`
  4. `click "Send"`
  5. `expect "Send"`
  6. `fill "Amount" "1"`
  7. `click "Continue"`
  8. `expect "Recent recipients"`
  9. `fill "To" "example.base.eth"`
  10. `expect "Resolves to"`
- **Reach (live)**:
  1. `goto "/home"`
  2. `click "Send"`
  3. `fill "Amount" "0.1"`
  4. `expect "available"`
  5. `click "Continue"`
  6. `fill "To" "jesse.base.eth"` (default; a different recipient needs explicit authorization)
  7. `click "Continue"`
  8. `expect "Confirm"`
- **Confirm (live, authorization-gated)**: After matching the reviewed recipient, amount, Base network and the review `From` row against the account anchor, check `data-money-action-id` on `Send $0.10`, then click once only under Rung 3 or Jesse's direct authorization; verify Activity if the success toast is missed.
- **Notes**: The dialog is labelled by `send-title`. Before any live confirm, read the full review and match the `To` address, amount and the `From` row against the approved task and account anchor. Routine UI verification stops before the marked confirm control. Fixture-backed name and recent-recipient behavior is in tests/browser/send-recipients.pw.ts; the fixture-session helper stages static recipient, prepare and pending-review responses through tests/browser/feature-map/fixtures.ts so Send reaches review without a provider or confirmation.
  1. **amount**: type into the `Amount` textbox (`inputmode="decimal"`, focused on open; `data-money-amount-input`, client/money-modal/amount.tsx). Paste and `,` or `.` decimals are accepted; extra decimals, letters and signs are rejected. The available line sits under the amount; over the fee-adjusted balance it turns destructive and reads `Only … available`. The quick-chip group `Quick amounts` (`$10`/`$25`/`Max` when priced) sits directly above `Continue`. `Continue` (or Enter) stays disabled until the amount is positive and within the balance.
  2. **destination**: step title stays `Send`; field label `To` (AddressField `id="send-recipient"`); primary `Continue` disabled until the typed value is a valid `0x` recipient or a resolved name (send-dialog.tsx `effectiveRecipient`). A `.eth` Basename/ENS value is resolved through `GET /api/transfers/recipient-name?name=…` and shows `Resolves to` with a condensed one-line address under the field; tapping it opens the full address and Copy button in a popover; while it resolves the field is described by `Resolving <name>…`; an unresolved or unsupported value shows an inline `role="alert"`/hint and never enables `Continue`. The account's own recent send recipients render below the `Or` separator under the group label `Recent recipients` (labelled by reverse-resolved name with the truncated address beneath, or the truncated address alone) and selecting one fills `To`.
  3. **confirm**: dialog title becomes `Confirm` (send-dialog.tsx `modalTitle`); summary via `MoneyConfirmSummary` rows `From` (short address from the prepared action's owner), `To` (condensed CopyableValue address; tap for the full address and Copy button), `Asset`, `Network` = `Base`, and `Network fee` when paid in USDC (send-dialog.tsx); primary button `Send $1.00` where amount is `MoneyTicker(confirmAmount)` — smoke clicks `getByRole("button", { name: "Send $1.00" })`; secondary `Back`.
  Every money confirm control (every surface) carries `data-money-action-id=<prepared action id>` (client/money-modal/money-modal.tsx `MoneyConfirmFooter`); no other control does.
  4. **submitting**: after the confirm click the primary keeps its label and focus with `aria-busy` and a spinner and ignores further presses; `Back` and close are disabled (client/money-modal/money-modal.tsx `MoneyConfirmFooter submitting`). While the review is prepared after `Continue`, or an `action` id in the URL is resumed, the Confirm sheet shows `Preparing review…` instead, also with close disabled.
  5. **error**: message + `Try again` (primary) and `Back`; the "ambiguous handle response retries without a second wallet dispatch" test asserts `Try again` then `Send $1.00` again and `sessionStorage["home:playwright-smoke:dispatch-count"] === "1"` (send.pw.ts).
  6. **result**: the sheet stays open on a `ResultHeader` result (client/money-modal/money-result.tsx) driven by the owner's `/api/actions` row: `$1.00 on its way` with `Submitted` / `Confirming on Base` steps and `Done` / `View in Activity`, then `$1.00 sent` + `Done`; `$1.00 wasn't sent` + `Try again`; an ambiguous dispatch shows `We can't confirm $1.00` with `View in Activity` / `Done` and no retry. The prepared `action` id is removed from the URL on submission, so reload never reopens the review. The toast `Sent $1.00 to 0x2222…222222` still appears (send.pw.ts; client/home/action-toasts.tsx).
- **Expect**: prepared action via `POST /api/actions/prepare` with a checksummed `0x` `recipient` and, for a name entry, `recipientName` re-resolved server-side (server rejects a name/address mismatch); recent recipients via `GET /api/transfers/recent-recipients` on dialog open, derived from this account's successfully dispatched durable send actions; confirm/handle via `/api/actions/[id]/{confirm,handle}` (smoke fixtures); dialog uses `data-money-sheet` / `data-money-sheet-grabber` (client/money-modal/money-modal.tsx) and reduced-motion transitions are `0s` (send.pw.ts ambiguous-handle retry test).
- **States**: asset picker (`aria-label="Asset"`, amount.tsx:443) with multiple assets; no catalog balance → `No catalog balance is available to send.`; rejected/unknown wallet results via `messageForError` (send-dialog.tsx); destination resolving/resolved/unresolved/unsupported-input states above; recent-recipients list empty (no confirmed sends) or populated; a superseded name resolution must not enable `Continue` (client/transfers/send-dialog-recipients.test.tsx).
- **Evidence**: screenshots per step; DOM snapshot per step (re-snapshot after every material DOM change per SKILL.md); console/errors; startup and first-action marks.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/transfers/send-dialog.tsx`, `apps/web/client/money-modal/`, `apps/web/shared/transfers/`, `apps/web/server/actions/` (prepare/confirm/handle/list), `apps/web/server/money-actions/`, `apps/web/server/transfers/`, routes `apps/web/app/api/actions/**` and `apps/web/app/api/transfers/**`.
- **Unknowns**: none blocking; exact `MoneyConfirmSummary` fee row for sends (USDC-paymaster sends show the `Network fee` row; native/disabled sends retain wallet fee warning).
