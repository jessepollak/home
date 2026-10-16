# Money ticker

- `apps/web/components/money-ticker.tsx` preserves exact already-formatted money strings and animates them with `@number-flow/react`.
- `MoneyWrapProvider` opts a ticker into a wrapping layout that breaks at grouping separators and drops the digit-width reservation; the default layout remains unwrapped.
