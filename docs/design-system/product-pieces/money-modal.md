# Money modal

- `apps/web/client/money-modal` owns amount entry, asset selection, review, and confirmation steps; its shell is the owned shadcn Drawer wrapper. At `lg` (1024px) the same mounted content appears as a centred, at-most-480px dialog with a viewport-bounded height; at narrower widths it remains a bottom sheet, including the existing `sm` width and swipe treatment. `MoneyModal` and the Borrow sheets opt in with `variant="money"`; other `AppDrawer` surfaces, such as sign-in, stay bottom sheets at every width.
  - Amount entry is a native `inputMode="decimal"` field that keeps amounts as exact decimal strings. Home draws no keypad.
  - The visual viewport drives `--sheet-keyboard-inset` (bottom obstruction) and `--sheet-keyboard-top` (panned top offset) for the sheet and footer; both bound the sheet's height, and the desktop dialog centres between them. The keyboard provider remains for focus and scroll handling, but the scroll body ignores its keyboard padding slack. The sheet's surface bleeds to the screen bottom beneath the keyboard, and its geometry freezes while closing.
  - The inset follows focus as well as the viewport. It counts only while a text field is focused, so moving focus to a non-text control (Continue to a step without a field, or a plain blur) starts the sheet's descent in the same frame the native keyboard starts dismissing, instead of waiting for the viewport to report the keyboard gone. The keyboard's own animation stays with the browser.
  - Closing starts the keyboard's dismissal. When the exit begins with a text field focused, focus moves to the current step, still inside the sheet, so the keyboard descends while the sheet slides out; the sheet stays mounted and its inset stays frozen until the exit completes. Scroll lock and trigger focus are released only then, and focus never returns to a text field that would reopen the keyboard.
  - One `MoneyModal` hosts a whole journey. Each screen is one `MoneyModalStep` (header, body and footer); changing step keeps the backdrop, focus trap and scroll lock, and plays a 180 ms directional fade/slide while the sheet's height eases over the same 180 ms: the bottom sheet's top edge rises or falls, and the desktop dialog resizes about its centre. A rapid step change retargets from the height on screen, and step content that arrives late (a lazy step replacing its loading state) keeps easing rather than snapping. Keyboard-driven size changes follow the keyboard inset instead. Under reduced motion the step fades only and the height changes instantly.
  - Two intents only. The header X, Escape, backdrop and swipe all call the host's exit (`onCancel`, blocked while an action is pending); it closes the whole journey from any step and never returns to a parent step. `onBack` moves one step inside the same host. Flows reset transient step state when the close finishes, so reopening starts at the entry step.
  - The header's leading track holds Back or the step's asset selector, and the trailing track holds X; both keep their intrinsic width, and the centered title truncates between them rather than overlapping either control. Amount steps put their selector (locked when the flow's asset is fixed, as in Buy and Sell) in that leading track, never in the body.
  - The step host is the single focus owner. Deferred trade entry points mount their sheet closed on pointer intent so the tap itself opens it and focuses the amount input; entering a step, including the first, focuses its amount input, else its marked primary control, else Back/X, inside the same commit as the tap that caused it, so a software keyboard can open without a second tap on a warm step. Amount fields do not self-focus; they refocus on an asset change only when the user is choosing inside the sheet. The host restores focus only when it was parked on the step or lost to a removed control, never after a deliberate dismissal. A cold lazy step shows its loading state in the open sheet and focuses the amount when it arrives, outside the tap, so its keyboard may need a tap.

## Composition API

Import money-flow pieces from `@/client/money-modal`; import `deferSheet` and `deferStep` from `@/client/money-modal/deferred-sheet` for lazy loading. Use `MoneyModal` as the host for money journeys; `AppDrawer` is only for non-money app sheets. Compose each screen with `MoneyModalStep` (or `MoneyModalStepLoading`), `MoneyModalHeader` and `MoneyModalBody`. The header accepts either `assetControl` for the amount step's top-left selector (locked when the flow's asset is fixed) or `onBack` for a nested step, never both. Use `MoneyModalFooter` for a primary/secondary pair, `MoneyConfirmFooter` for a required prepared-action confirm, and `MoneyModalActions` for custom footer content. Results use `MoneyResult` and `MoneyResultFooter`; amount entry uses `MoneyAmountDisplay` and `MoneyAssetPicker`.

## Approved variants

- Entry step with a header asset selector.
- Nested step with Back in the leading track.
- Detail or management tray without amount entry (such as activity detail or Borrow overview), using `MoneyModal`, header, body, and `MoneyModalActions`.
- Loading step via `MoneyModalStepLoading`.
- Result step via `MoneyResult` and `MoneyResultFooter`.

## Loading and in-flight work

While prepare, quote, resume, wallet-signature, or verify work is in flight, keep the **current** `MoneyModalStep` key and depth, header, body content, and footer mounted. Show progress on its primary footer control (`MoneyModalFooter primaryLoading`, `MoneyConfirmFooter submitting`, or owned `Button loading`); keep it disabled and `aria-busy` while loading. A short loading label on that button (such as “Getting quote…”) is fine. Surface errors on the step that started the work; prevent double submission and keep `useMoneyModalPending` exit blocking unchanged. Advance only when the next screen’s data is ready (review/confirm, or `MoneyResult` pending/result). Do not replace the sheet body with a transient notice, bare spinner, or spinner-only step; do not remove its footer, flip body padding, or title the next step “Confirm” before it is ready. See `client/activity/activity-ledger-sheet.tsx` for the prepare-button pattern.

`MoneyModalStepLoading` remains the lazy chunk-loading fallback before a step exists, not a placeholder for asynchronous work within an already mounted step.

## Add a new money flow

- Use one `MoneyModal` per journey and one `MoneyModalStep` per screen, keyed by step; lazy-load the entry with `deferSheet` and nested steps with `deferStep`.
- Confirm with `MoneyConfirmFooter` and its prepared action.
- X exits through the host's `onCancel`; Back moves within the journey through `onBack`.
- Register in-flight work with `pending` or `useMoneyModalPending`.
- Never import Drawer, Dialog, or `createPortal` into a money flow; lint enforces this boundary (see [repository gates](../../gates.md)).
