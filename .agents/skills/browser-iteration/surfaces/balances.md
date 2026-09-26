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
- **States**: loading shimmer (`BalancesListFallback`, balances-list.tsx); unavailable; empty (`BalancesEmpty`); ready with reveal batches; stale revalidation anchored to requested group (`cold and revalidated cached Balances…` smoke test).
- **Evidence**: screenshot; DOM snapshot; console/errors; perf marks and scroll-offset assertions.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms; `session:verified` ≤ 3_000 ms; `balances:painted` ≤ 3_500 ms; `action:first-interactive` ≤ 3_500 ms.
- **Live perf budgets**: `session:verified` ≤ 10_000 ms
- **Owned by**: `apps/web/client/home/balances-panel.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/client/balances/use-balances.ts`, `/api/balances`.
- **Unknowns**: none; incremental batches use an intersection sentinel rather than a reveal-more button, group anchors come from `/balances/<group>` URLs, and the empty state is `No money yet`.
