### `balances`
- **Entry context**: home/balances · `/balances`, `/balances/cash`, `/balances/investments` · same as home-panel · signed-in seed + balances fixture; `scrollableBalancesSnapshot()` for reveal/scroll · goto path (Home no longer links here since #789; #686 owns the shell collapse).

- **Live**: read-only
- **Owned paths**: `apps/web/app/balances/**`, `apps/web/client/home/balances-*.tsx`, `apps/web/client/balances/**`, `apps/web/server/balances/**`, `apps/web/app/api/balances/**`
- **Reach**:
  1. `goto "/balances"`
  2. `expect "Your money"`
  3. `expect "Recognized Coin"`
- **Reach (live)**:
  1. `goto "/balances"`
  2. `expect "Your money"`
- **Notes**: The fixture-session helper seeds signed-in state and balances fixture. Use `/balances/investments` with `scrollableBalancesSnapshot()` for anchoring work; the group section is `id="investments"`.
- **Expect**: scroll container `[data-app-main-authenticated]` (shell-panels.tsx); balance rows `[data-balance-list] [data-kind="balance"]` (balances.pw.ts); reveal window grows after scroll (`BALANCES_BATCH_SIZE = 10`, client/home/balances-panel.tsx); `Show small balances` switch lives in account settings, not this page (mobile-geometry.pw.ts touch test).
  Group subtotals use foreground complete values, `Partial balance` plus an unanimated foreground known amount for partial, or `—` (accessible as `Unavailable`) for unavailable (`data-subtotal-status`). The status line offers `Retry balances` for partial/unavailable totals when recovery is supplied, except when a country choice is needed.
- **States**: loading shimmer (`BalancesListFallback`, balances-list.tsx); failed read (`Balance unavailable` status line with Retry, no groups); ready snapshot with unreadable holdings (named `Unavailable` rows, a partial or `—` subtotal, status-line Retry); incomplete or unavailable catalog coverage (the Investments group still renders its `—` figure with no rows, story `balances-page--catalog-unavailable`); partial (known subtotals and status-line Retry); empty (`BalancesEmpty`); ready with reveal batches; Unpriced section after Investments for held wallet tokens without a price (foreground quantity plus `—` and the actual valuation reason; the shared fixture has none, so use story `balances-page--with-unpriced-tokens`); stale revalidation anchored to requested group (`cold and revalidated cached Balances…` smoke test).
- **Evidence**: screenshot; DOM snapshot; console/errors; perf marks and scroll-offset assertions.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/home/balances-panel.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/client/balances/use-balances.ts`, `/api/balances`.
- **Unknowns**: a named unreadable holding keeps its `Unavailable` row and one Home cannot name has none, but either still makes its group subtotal incomplete; incremental batches use an intersection sentinel rather than a reveal-more button, group anchors come from `/balances/<group>` URLs, and the empty state is `No money yet`.
