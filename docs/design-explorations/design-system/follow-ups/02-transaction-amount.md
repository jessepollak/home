# 2. TransactionAmount header

| # | Follow-up | Disposition | Delivery | State (2026-09-25) |
| --- | --- | --- | --- | --- |
| 2 | TransactionAmount header | Implemented | [#942](https://github.com/jessepollak/home/issues/942), scope extended September 25; PR [#974](https://github.com/jessepollak/home/pull/974); superseded by [#967](https://github.com/jessepollak/home/issues/967) | merged in #974; #967 moves the signed amount and status Badge header into the Activity ledger detail sheet (`apps/web/client/activity/activity-ledger-sheet.tsx`) and removes `components/transaction-amount.tsx` and its Code Connect mapping |
| 2a | Figma `TransactionAmount` set `282:5882` after the ledger adoption | Deferred (owner: Jesse) | [#967](https://github.com/jessepollak/home/issues/967) review | the set has no code component or Code Connect mapping; the ledger sheet header is drawn in the Activity ledger design section (`308:5918`), so Jesse decides whether to retire the set or re-point it at the ledger sheet |
