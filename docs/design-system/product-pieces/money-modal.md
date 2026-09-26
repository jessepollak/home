# Money modal

- `apps/web/client/money-modal` owns amount entry, asset selection, review, and confirmation steps; its shell is the owned shadcn Drawer wrapper.
  - Amount entry is a native `inputMode="decimal"` field that keeps amounts as exact decimal strings. Home draws no keypad.
  - The money sheet passes `keyboardAware` to `Drawer`, which wraps Base UI's `Drawer.VirtualKeyboardProvider`. The sheet and its footer follow `--drawer-keyboard-inset`, so Continue stays above the software keyboard. Nothing else listens to the visual viewport.
