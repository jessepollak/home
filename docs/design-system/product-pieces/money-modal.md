# Money modal

- `apps/web/client/money-modal` owns amount entry, asset selection, review, and confirmation steps; its shell is the owned shadcn Drawer wrapper.
  - Amount entry is a native `inputMode="decimal"` field that keeps amounts as exact decimal strings. Home draws no keypad.
  - The visual viewport drives `--sheet-keyboard-inset` for the sheet and footer; the keyboard provider remains for focus and scroll handling, but the scroll body ignores its keyboard padding slack. The sheet's surface bleeds to the screen bottom beneath the keyboard, and its geometry freezes while closing.
