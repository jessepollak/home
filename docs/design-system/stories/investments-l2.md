# Investments holdings production stories

`investments-holdings--funded` and `investments-holdings--funded-desktop` cover the selected holdings hierarchy. Other `investments-holdings--*` stories cover empty, loading, failed, refresh-failed (on the list and on tradable and non-tradable details), partial, unread inventory (an unread balance is not listed as owned), unpriced, metadata fallback, collateral, matching cash, 60 holdings and focus return, duplicate names, deterministic ties, narrow and large-value layouts, and catalog, discovered, stock, collateral and noncatalog details. `investments-holdings--detail-collateral-known-zero` and `investments-holdings--detail-collateral-unavailable` verify Sell stays disabled against the displayed wallet snapshot.

`journeys-investments-holdings--home-to-holdings` and `journeys-investments-holdings--home-to-holdings-desktop` walk Home → holdings → Bitcoin → Buy/Sell → Back to the focused Bitcoin row → Back to the focused Home row. Route, native Back, and refresh behavior must be verified in the app, not the story.

# Investments L2 proposal

Unreviewed proposal for #1038; production adoption #1040. These fixture-backed exploration stories are not production routes or trade-eligibility changes.

Board: `review-boards--investments`.

- Shared comparison: `cash-cash-l2--shared-portfolio`, `explorations-investments-l2--matching-cash`.
- Holdings: `explorations-investments-l2--funded`, `explorations-investments-l2--funded-desktop`, `explorations-investments-l2--single`, `explorations-investments-l2--many-holdings`, `explorations-investments-l2--many-holdings-focus-return`, `explorations-investments-l2--empty`, `explorations-investments-l2--loading`, `explorations-investments-l2--partial-inventory`, `explorations-investments-l2--registry-outage`, `explorations-investments-l2--unpriced`, `explorations-investments-l2--metadata-fallback`, `explorations-investments-l2--duplicate-names-focus-return`, `explorations-investments-l2--refresh-failed`, `explorations-investments-l2--balances-failed`, `explorations-investments-l2--collateral`, `explorations-investments-l2--collateral-without-available-entry`, `explorations-investments-l2--collateral-catalog-complete-registry-partial`, `explorations-investments-l2--partial-borrow-coverage`, `explorations-investments-l2--partial-borrow-no-holdings`, `explorations-investments-l2--narrow`, `explorations-investments-l2--home-row-parity`.
- Detail: `explorations-investments-l2--detail`, `explorations-investments-l2--detail-discovered`, `explorations-investments-l2--detail-collateral`, `explorations-investments-l2--detail-collateral-partial-inventory`, `explorations-investments-l2--detail-collateral-known-zero`, `explorations-investments-l2--detail-collateral-unavailable`, `explorations-investments-l2--detail-stock`, `explorations-investments-l2--detail-not-listed`.
- Journey: the board's journey frames show the production journey above.

The empty state is only the $0.00 hero, with no Explore investments action. The holdings list initially renders 20 rows and adds 20 as the bottom nears the viewport, until every asset is present; returning from a detail reveals and focuses its holding. The Many Holdings fixture checks 60 priced assets, exact total parity, ordering and row hit targets.

Progressive rendering keeps unrendered rows out of find-in-page; production adoption (#1040) weighs this tradeoff. A collateral asset whose wallet balance is unavailable, or has no wallet record while the inventory source that owns it is incomplete, shows an unavailable total while its Collateral value remains visible. Registry assets always carry a wallet record, so a collateral asset without one is owned by the catalog scan, and only catalog coverage decides whether its available balance is a known zero. A failed borrow-market read shows the balance recovery state but does not make wallet balances unknown.

The shared snapshot is a story-only fixture under `client/invest/explorations/`. With a valid partial snapshot, TradeActions disables Sell when the asset's wallet balance is unavailable without giving a Sell-specific reason; #1040 should give TradeActions a per-asset note (for example, "Bitcoin balance isn't available right now.") ordered before the Buy note when the asset's balance is unavailable.
