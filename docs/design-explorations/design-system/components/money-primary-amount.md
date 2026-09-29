# MoneyPrimaryAmount

| Item | Code | Story and historical design | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| MoneyPrimaryAmount | yes | `client/money-modal/amount.stories.tsx` reviews empty, entered and error states with a native numeric input. Prefix, digits, caret room and suffix centre as one run; the over-available state shows `Only … available`. Cash in the display currency shows fiat without a toggle; priced non-cash assets show the unit toggle; unpriced assets show native units. Chips sit above the CTA. Whole-amount centring follows Jesse's [#1015](https://github.com/jessepollak/home/issues/1015) decision. | yes | Input `variant="amount"` | `client/money-modal/amount.tsx` | P0 |
