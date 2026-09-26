### `toasts`
- **Entry context**: home · any dashboard route after action · signed-in · action fixture (tests/browser/fixtures/api.ts; send.pw.ts) · action completion (action-toasts.tsx).

- **Live**: read-only
- **Owned paths**: `apps/web/client/home/action-toasts.tsx`, `apps/web/server/actions/**`, `apps/web/app/api/actions/**`
- **Reach**: Complete a prepared action (smoke: send success) and observe the toast region.
- **Verify**: manual
- **Expect**: exact success copy e.g. `Sent $1.00 to 0x2222…222222` (send.pw.ts); renders only when `routeMode === "dashboard" && isVerified` (shell.tsx).
- **States**: pending/confirmed/failed toast variants (client/home/action-toasts.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/home/action-toasts.tsx`, `/api/actions`.
- **Unknowns**: none; pending/confirmed verbs are defined for savings and Borrow operations, and failures use `<Action> failed: <reason>`.
