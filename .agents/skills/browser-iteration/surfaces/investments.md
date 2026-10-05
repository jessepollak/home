### `investments`
- **Entry context**: home/investments · `/investments`, `/investments/native|0x<40-hex-address>` · signed-in; signed-out redirects to sign-in · session + `/api/balances` fixtures (`manyOwnedInvestmentsSnapshot()` for scroll/focus) · Home `Your money` Investments row, an owned asset's Activity detail Asset row, or goto path.

- **Live**: read-only
- **Owned paths**: `apps/web/app/(shell)/investments/**`, `apps/web/client/investments/**`, `apps/web/shared/balances/owned-investments.ts`
- **Reach**:
  1. `goto "/investments"`
  2. `expect "Investments"`
  3. `expect "Your investments"`
- **Reach (live)**:
  1. `goto "/home"`
  2. `expect "Your money"`
  3. Open the Investments row when holdings are present; otherwise the `Start investing` row goes to `/invest` discovery.
  4. Read the Investments headline and open an owned asset; do not prepare or confirm a trade.
- **Expect**: Home Investments row opens `/investments` for a nonempty holding set and its value matches the `Investments balance` headline; empty `Start investing` opens `/invest`. The list has `Your investments` with owned holdings sorted by value and a 20-row incremental reveal on scroll. The Bitcoin/cbBTC row opens `/investments/0x<address>`, with `Bitcoin` in the nested header, `Your balance`, and Buy/Sell controls. Header and browser Back return to the list with focus on the opened row; browser Back from the list returns Home. Refresh preserves a direct detail route; its header Back replaces that entry with `/investments`. Main navigation Invest always goes to `/invest` discovery, not these holdings.
- **States**: loading shimmer; partial hero total muted with visible and accessible description `Some balances are unavailable`; fully unavailable hero total `—` announced `Unavailable` with `Try again`; complete empty portfolio shows `$0.00`; owned holdings are complete/partial/unavailable by wallet and collateral leg, with partial amounts muted and labelled `Partial balance`, and unavailable amounts `—` announced `Unavailable`, never zero; partial detail amounts have `Some balances are unavailable` as their accessible description; unavailable detail amounts have `Try again` even for readable unpriced holdings, and the exact quantity line stays whenever every leg balance is readable; partial Home Investments count reads `Across at least N assets`; failed refresh retains known amounts with `Couldn't refresh` and `Try again` on both the list and an owned detail's `Your balance` card alongside the header interrupted-updates status; long holdings lists progressively reveal batches; their visible-row count lives in the route history entry so browser Back restores document scroll/focus; owned assets without a tradable listing show `Trading isn't available for this asset.`.
- **Evidence**: screenshot; full-text DOM snapshot (including headline and holding balance); console/errors; navigation URL, focused row and scroll-in-view observations.
- **Owned by**: `apps/web/client/investments/`, `apps/web/shared/balances/owned-investments.ts`, Home shell route wiring.
- **Unknowns**: live holdings depend on the signed-in account and may be empty; fixture routes do not model provider trades, so Buy/Sell availability or review/confirm is not verified by this Reach.
