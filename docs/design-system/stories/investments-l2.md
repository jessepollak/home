# Investments holdings production stories

`investments-holdings--funded` and `investments-holdings--funded-desktop` cover the selected holdings hierarchy. Other `investments-holdings--*` stories cover empty, loading, initial load failure, retained holdings after a failed refresh, unpriced, metadata fallback, collateral, matching cash, 60 holdings and focus return, duplicate names, deterministic ties, narrow and large-value layouts, and catalog, discovered, stock, collateral and noncatalog details. `investments-holdings--detail-collateral-known-zero` verifies Sell stays disabled against the displayed zero wallet balance.

`journeys-investments-holdings--home-to-holdings` and `journeys-investments-holdings--home-to-holdings-desktop` walk Home → holdings → Bitcoin → Buy/Sell → Back to the focused Bitcoin row → Back to the focused Home row. Route, native Back, and refresh behavior must be verified in the app, not the story.

# Investments L2 proposal

Unreviewed proposal for #1038; production adoption #1040. These fixture-backed exploration stories are not production routes or trade-eligibility changes.

Board: `review-boards--investments`.

- Shared comparison: `cash-cash-l2--shared-portfolio`, `explorations-investments-l2--matching-cash`.
- Holdings: `explorations-investments-l2--funded`, `explorations-investments-l2--funded-desktop`, `explorations-investments-l2--single`, `explorations-investments-l2--many-holdings`, `explorations-investments-l2--many-holdings-focus-return`, `explorations-investments-l2--empty`, `explorations-investments-l2--loading`, `explorations-investments-l2--unpriced`, `explorations-investments-l2--metadata-fallback`, `explorations-investments-l2--duplicate-names-focus-return`, `explorations-investments-l2--collateral`, `explorations-investments-l2--narrow`, `explorations-investments-l2--home-row-parity`.
- Detail: `explorations-investments-l2--detail`, `explorations-investments-l2--detail-discovered`, `explorations-investments-l2--detail-collateral`, `explorations-investments-l2--detail-collateral-known-zero`, `explorations-investments-l2--detail-stock`, `explorations-investments-l2--detail-not-listed`.
- Journey: the board's journey frames show the production journey above.

The empty state is only the $0.00 hero, with no Explore investments action. The holdings list initially renders 20 rows and adds 20 as the bottom nears the viewport, until every asset is present; returning from a detail reveals and focuses its holding. The Many Holdings fixture checks 60 priced assets, exact total parity, ordering and row hit targets.

Progressive rendering keeps unrendered rows out of find-in-page; production adoption (#1040) weighs this tradeoff. The collateral detail stories distinguish available wallet balances from collateral; the known-zero fixture keeps Sell disabled.

The shared snapshot is a story-only fixture under `client/invest/explorations/`.
