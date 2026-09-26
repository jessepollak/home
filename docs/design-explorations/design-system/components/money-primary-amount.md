# MoneyPrimaryAmount

| Item | Code | Figma | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| MoneyPrimaryAmount | yes | `166:1776` state=empty\|entered\|error as a native numeric input with a caret. The amount and available line are centred with 12px between them; revision 3 centres the digits' ink on the helper axis, with the caret hanging right. `state=error` keeps the amount foreground and turns the available line into a destructive explanation. Since #941, code matches: `MoneyAmountDisplay` renders an `inputMode="decimal"` input, and `overAvailable` shows the destructive `Only … available` line. The unit toggle sits under the available line, and the chips sit above the CTA. Ink-centring the digits is not implemented yet ([#1002](https://github.com/jessepollak/home/issues/1002)); code centres the prefix, digits and suffix together. | yes | Input `variant="amount"` | `client/money-modal/amount.tsx` | P0 |
