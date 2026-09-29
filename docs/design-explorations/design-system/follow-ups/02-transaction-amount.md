# 2. TransactionAmount header

| # | Follow-up | Disposition | Delivery | State (2026-09-25) |
| --- | --- | --- | --- | --- |
| 2 | TransactionAmount header | Implemented | [#942](https://github.com/jessepollak/home/issues/942), scope extended September 25; PR [#974](https://github.com/jessepollak/home/pull/974); superseded by [#967](https://github.com/jessepollak/home/issues/967) | merged in #974; #967 moves the signed amount and status Badge header into the Activity ledger detail sheet (`apps/web/client/activity/activity-ledger-sheet.tsx`) and removes `components/transaction-amount.tsx` |
| 2a | Retired TransactionAmount design set | Superseded by Storybook review | [#967](https://github.com/jessepollak/home/issues/967) review | compare the ledger sheet header with its Storybook story; the earlier standalone set has no code component |
