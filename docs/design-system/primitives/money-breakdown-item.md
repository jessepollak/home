# Money breakdown item

- The balance breakdown renders in `apps/web/client/home/home-overview.tsx`; the bar and legend are `SignedBalanceBar` and `MoneyBreakdownLegend` in `apps/web/components/signed-balance-bar.tsx`, over the `MoneyBreakdownItem` type in `apps/web/shared/balances/present.ts`.
- Legend labels stay secondary; numerical amounts and unavailable `—` figures use a foreground value slot inherited by `MoneyTicker`. Partial known amounts do not animate; unavailable entries remain disabled on the same control.
- Review `MoneyBreakdownItem` in the relevant Storybook stories.
