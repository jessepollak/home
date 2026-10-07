### `toasts`
- **Entry context**: home · any dashboard route after action · signed-in · action fixture (tests/browser/fixtures/api.ts; send.pw.ts) · action completion (action-toasts.tsx).

- **Live**: read-only
- **Owned paths**: `apps/web/client/home/action-toasts.tsx`, `apps/web/server/actions/**`, `apps/web/app/api/actions/**`
- **Reach**: Complete a prepared action (smoke: send success) and observe the toast region.
- **Cash-out entry**: New cash-outs start at Home → Cash out (`flow=cash-out`), not Send. Activity → pending cash-out → details → Cancel → withdrawal review remains recovery in the Activity sheet. Choosing an entry, Retry, or Send USDC, and preparing/resuming a review do not confirm or dispatch an action and must not produce a completion toast. Fixture entry coverage stops before the marked confirm control; it does not prove post-confirm toast behavior.
- **Verify**: manual
- **Expect**: exact success copy e.g. `Sent $1.00 to 0x2222…222222` (send.pw.ts); renders only when `routeMode === "dashboard" && isVerified` (shell.tsx).
- **States**: pending/confirmed/failed toast variants (client/home/action-toasts.tsx); on a same-owner presentation-region change, dismiss active fiat-amount toasts without replaying the action, retain failure alerts and token-amount toasts, and format later status transitions in the new region. Owner changes still close active toasts.
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/home/action-toasts.tsx`, `/api/actions`.
- **Unknowns**: none; pending/confirmed verbs are defined for savings and Borrow operations, and failures use `<Action> failed: <reason>`.
