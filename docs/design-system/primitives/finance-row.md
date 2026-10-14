# Finance row

- `FinanceRow` in `apps/web/components/finance-rows.tsx`, wrapped by `ActivityRow`, `BalanceRow` and `AssetRow`.
- Review `FinanceRow` in the `finance-rows` Storybook stories; the lone-value alignment rule is tracked separately.
- Use `valueKind="status"` for text statuses without a label suffix: the status yields space to the name first, both wrap in full with no line limit and break mid-word only when one word cannot fit, and amounts keep their existing layout.
