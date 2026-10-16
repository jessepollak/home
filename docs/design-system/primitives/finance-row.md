# Finance row

- `FinanceRow` in `apps/web/components/finance-rows.tsx`, wrapped by `ActivityRow`, `BalanceRow` and `AssetRow`.
- Review `FinanceRow` in the `finance-rows` Storybook stories; the lone-value alignment rule is tracked separately.
- Use `valueKind="status"` for text statuses without a label suffix: the status yields space to the name first, both wrap in full with no line limit and break mid-word only when one word cannot fit, and amounts keep their existing layout.
- A name on an amount row shows in full or ends in an ellipsis; below a 14rem row it wraps in full instead. An amount wraps at spaces and at grouping separators between digits (`12,` / `345,` / `678.90 USDC`) and splits mid-digit only when one digit group alone cannot fit.
- At 14rem and narrower, a name or status that must break mid-word uses `hyphens: auto`, so it shows a hyphen where the platform's dictionary supports one. Wider rows keep `hyphens: manual`, which preserves the one-word minimum width of a status.
- An element-valued amount (`MoneyTicker`) wraps at the same grouping separators as a string amount.
